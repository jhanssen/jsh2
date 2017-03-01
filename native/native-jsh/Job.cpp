#include "Job.h"
#include "utils.h"
#include <uv.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <unordered_map>
#include <map>

std::unordered_set<std::shared_ptr<Job> > Job::sJobs;

// we're going to need a thread that reads the out/err of the final process in our jobs

class JobReader;
class JobWaiter;

struct {
    std::shared_ptr<JobReader> reader;
    std::shared_ptr<JobWaiter> waiter;
    Mutex stdinMutex;
} static state;

class JobReader
{
public:
    JobReader()
        : mStopped(false)
    {
        ::pipe(mPipe);

        const int r = fcntl(mPipe[0], F_GETFL);
        fcntl(mPipe[0], F_SETFL, r | O_NONBLOCK);
    }
    ~JobReader()
    {
        ::close(mPipe[0]);
        ::close(mPipe[1]);
    }

    void add(const std::shared_ptr<Job>& job)
    {
        JobData data = { job->mStdin, job->mStdout, job->mStderr, true, 0, 0, Buffer::Data() };

        int r;
        // make read pipes non-blocking
        if (data.stdin != -1) {
            r = fcntl(data.stdin, F_GETFL);
            fcntl(data.stdin, F_SETFL, r | O_NONBLOCK);
        }

        if (data.stdout != -1) {
            r = fcntl(data.stdout, F_GETFL);
            fcntl(data.stdout, F_SETFL, r | O_NONBLOCK);
        }

        if (data.stderr != -1) {
            r = fcntl(data.stderr, F_GETFL);
            fcntl(data.stderr, F_SETFL, r | O_NONBLOCK);
        }

        MutexLocker locker(&mMutex);
        mReads[job] = std::move(data);
        wakeup();
    }

    void start()
    {
        uv_thread_create(&mThread, JobReader::run, this);
    }

    void stop()
    {
        {
            MutexLocker locker(&mMutex);
            mStopped = true;
        }
        wakeup();
        uv_thread_join(&mThread);
    }

    void wakeup();

private:
    void run();

    static void run(void* arg)
    {
        JobReader* r = static_cast<JobReader*>(arg);
        r->run();
    }

    uv_thread_t mThread;
    Mutex mMutex;
    int mPipe[2];
    bool mStopped;

    struct JobData
    {
        int stdin, stdout, stderr;

        bool needsWrite;
        size_t pendingOff, pendingRem;
        Buffer::Data pendingWrite;
    };

    std::map<std::weak_ptr<Job>, JobData, std::owner_less<std::weak_ptr<Job> > > mReads;
};

void JobReader::wakeup()
{
    int e;
    char c = 'w';
    EINTRWRAP(e, ::write(mPipe[1], &c, 1));
}

void JobReader::run()
{
    enum ReadStatus { Ok, Closed, Error };
    auto handleRead = [](const std::shared_ptr<Job>& weak, int fd, Buffer& buffer) -> ReadStatus {
        int e;
        uint8_t buf[32768];
        for (;;) {
            EINTRWRAP(e, ::read(fd, buf, sizeof(buf)));
            if (e == -1) {
                if (errno == EAGAIN || errno == EWOULDBLOCK)
                    return Ok;
                return Error;
            }
            if (e == 0) {
                // file descriptor closed
                return Closed;
            }

            buffer.add(buf, e);
        }
        return Error;
    };

    fd_set rdset, actualwrset;
    fd_set* wrset = 0;
    for (;;) {
        // select on everything
        wrset = 0;
        FD_ZERO(&rdset);
        FD_SET(mPipe[0], &rdset);
        int max = mPipe[0];
        // add the rest
        {
            MutexLocker locker(&mMutex);
            if (mStopped)
                break;

            std::vector<std::weak_ptr<Job> > bad;
            for (auto& r : mReads) {
                auto& jobdata = r.second;
                if (jobdata.stderr != -1) {
                    FD_SET(jobdata.stderr, &rdset);
                    if (jobdata.stderr > max)
                        max = jobdata.stderr;
                }
                if (jobdata.stdout != -1) {
                    // printf("adding out %d\n", jobdata.stdout);
                    FD_SET(jobdata.stdout, &rdset);
                    if (jobdata.stdout > max)
                        max = jobdata.stdout;
                }
                if (jobdata.stdin != -1) {
                    if (jobdata.needsWrite) {
                        if (std::shared_ptr<Job> job = r.first.lock()) {
                            jobdata.needsWrite = false;
                            Buffer::Data data;
                            size_t dataOff = 0, dataRem = 0;
                            if (!jobdata.pendingWrite.empty()) {
                                data = std::move(jobdata.pendingWrite);
                                dataOff = jobdata.pendingOff;
                                dataRem = jobdata.pendingRem;
                                jobdata.pendingOff = 0;
                                jobdata.pendingRem = 0;
                            } else {
                                data.resize(32768);
                            }
                            int e;
                            for (;;) {
                                if (!dataRem) {
                                    dataOff = 0;
                                    MutexLocker locker(&state.stdinMutex);
                                    dataRem = job->mStdinBuffer.read(&data[0], data.size());
                                    if (!dataRem) {
                                        // nothing more to do
                                        if (job->mStdinClosed) {
                                            if (jobdata.stdin != STDIN_FILENO) {
                                                // printf("closed stdin %d\n", jobdata.stdin);
                                                ::close(jobdata.stdin);
                                            }
                                            jobdata.stdin = -1;
                                            jobdata.needsWrite = false;
                                        }
                                        break;
                                    }
                                }
                                // printf("writing %zu bytes to stdin %d\n", dataRem, jobdata.stdin);
                                // printf("native writing %s\n", std::string(reinterpret_cast<char*>(&data[0]) + dataOff, dataRem).c_str());
                                EINTRWRAP(e, ::write(jobdata.stdin, &data[0] + dataOff, dataRem));
                                // printf("wrote %d bytes to stdin %d\n", e, jobdata.stdin);
                                if (e == -1) {
                                    if (errno == EAGAIN || errno == EWOULDBLOCK) {
                                        jobdata.pendingWrite = std::move(data);
                                        jobdata.pendingRem = dataRem;
                                        jobdata.pendingOff = dataOff;
                                    } else {
                                        // bad job
                                        bad.push_back(r.first);
                                    }
                                    break;
                                }
                                dataRem -= e;
                                dataOff += e;
                            }
                        } else {
                            // bad job
                            bad.push_back(r.first);
                            continue;
                        }
                    }
                }
                if (!jobdata.pendingWrite.empty()) {
                    // printf("still have pendingwrite\n");
                    assert(jobdata.stdin != -1);
                    wrset = &actualwrset;
                    FD_ZERO(&actualwrset);
                    FD_SET(jobdata.stdin, &actualwrset);
                    if (jobdata.stdin > max)
                        max = jobdata.stdin;
                } else {
                    // printf("no pendingwrite\n");
                    // we might have more data on stdin
                    if (std::shared_ptr<Job> job = r.first.lock()) {
                        MutexLocker locker(&state.stdinMutex);
                        if (!job->mStdinBuffer.empty()) {
                            // printf("but buffer is not empty\n");
                            jobdata.needsWrite = true;
                        } else if (job->mStdinClosed) {
                            // printf("wanting to close\n");
                            if (jobdata.stdin != STDIN_FILENO) {
                                // printf("closed stdin %d\n", jobdata.stdin);
                                ::close(jobdata.stdin);
                            }
                            jobdata.stdin = -1;
                        }
                    } else {
                        bad.push_back(r.first);
                    }
                }
            }
            for (const auto j : bad) {
                mReads.erase(j);
            }
        }
        // printf("selecting %d\n", max);
        int r = ::select(max + 1, &rdset, wrset, 0, 0);
        // printf("selected %d\n", r);
        if (r > 0) {
            if (FD_ISSET(mPipe[0], &rdset)) {
                // drain pipe
                char c;
                int e;
                for (;;) {
                    EINTRWRAP(e, ::read(mPipe[0], &c, 1));
                    if (e != 1)
                        break;
                }

            }
            {
                Buffer buffer;

                MutexLocker locker(&mMutex);
                std::vector<std::weak_ptr<Job> > bad;
                for (auto& r : mReads) {
                    auto& jobdata = r.second;
                    bool handled = true;
                    bool outclosed = false;
                    if (jobdata.stdout != -1 && FD_ISSET(jobdata.stdout, &rdset)) {
                        // printf("handling out\n");
                        handled = false;
                        if (std::shared_ptr<Job> job = r.first.lock()) {
                            auto state = handleRead(job, jobdata.stdout, buffer);
                            switch (state) {
                            case Ok:
                                handled = true;
                                job->stdout()(job, std::move(buffer));
                                buffer.clear();
                                break;
                            case Closed:
                                // printf("out closed\n");
                                handled = true;
                                outclosed = true;
                                jobdata.stdout = -1;
                                if (!buffer.empty())
                                    job->stdout()(job, std::move(buffer));
                                job->ioClosed()(job, Job::Stdout);
                                break;
                            case Error:
                                break;
                            }
                        }
                    }
                    if (jobdata.stderr != -1 && FD_ISSET(jobdata.stderr, &rdset)) {
                        handled = false;
                        if (std::shared_ptr<Job> job = r.first.lock()) {
                            auto state = handleRead(job, jobdata.stderr, buffer);
                            switch (state) {
                            case Ok:
                                handled = true;
                                job->stderr()(job, std::move(buffer));
                                buffer.clear();
                            case Closed:
                                // printf("err closed\n");
                                if (!outclosed)
                                    handled = true;
                                jobdata.stderr = -1;
                                if (!buffer.empty())
                                    job->stderr()(job, std::move(buffer));
                                job->ioClosed()(job, Job::Stderr);
                                break;
                            case Error:
                                break;
                            }
                        }
                    }
                    if (!handled) {
                        // bad job, take it out
                        bad.push_back(r.first);
                    } else if (wrset && FD_ISSET(jobdata.stdin, wrset)) {
                        jobdata.needsWrite = true;
                    }
                }
                for (const auto j : bad) {
                    mReads.erase(j);
                }
            }
        }
    }
}

// we also need to handle SIGCHLD

class JobWaiter
{
public:
    JobWaiter() { }
    ~JobWaiter() { }

    void start();
    void stop();

private:
    uv_signal_t mHandler;

    static uv_async_t sAsync;
};

uv_async_t JobWaiter::sAsync;

void JobWaiter::start()
{
    uv_async_init(uv_default_loop(), &sAsync, [](uv_async_t*) {
            // printf("SIGCHLD\n");
            int status;
            pid_t w;
            std::vector<std::shared_ptr<Job> > dead;
            for (auto job : Job::sJobs) {
                for (auto& proc : job->mProcs) {
                    EINTRWRAP(w, waitpid(proc.pid(), &status, WNOHANG | WUNTRACED));
                    if (w > 0) {
                        job->updateState(proc, status);
                        if (job->isTerminated()) {
                            job->setStatus(status);
                            // if our job is completely done we should notify someone(tm)
                            if (job->isIoClosed()) {
                                job->stateChanged()(job, Job::Terminated, status);
                                // and die
                                dead.push_back(job);
                            }
                        } else if (job->isStopped()) {
                            // save terminal modes in job if it's in the foreground
                            if (job->mMode == Job::Foreground) {
                                tcgetattr(STDIN_FILENO, &job->mTmodes);
                            }
                            job->stateChanged()(job, Job::Stopped, 0);
                        }
                    }
                }
            }
            for (auto job : dead) {
                // printf("erasing from jobs(1)\n");
                Job::sJobs.erase(job);
            }
        });

    uv_signal_init(uv_default_loop(), &mHandler);
    uv_signal_start(&mHandler, [](uv_signal_t*, int) {
            uv_async_send(&sAsync);
        }, SIGCHLD);
}

void JobWaiter::stop()
{
    uv_signal_stop(&mHandler);
}

void Job::updateState(Process& proc, int status)
{
    proc.mStatus = status;
    if (WIFSTOPPED(status)) {
        proc.mState = Process::Stopped;
    } else {
        proc.mState = Process::Terminated;
    }
    proc.stateChanged()(&proc, proc.mState);
}

void Job::setMode(Mode m, bool resume)
{
    switch (m) {
    case Foreground: {
        tcsetpgrp(STDIN_FILENO, mPgid);
        if (resume) {
            tcsetattr(STDIN_FILENO, TCSADRAIN, &mTmodes);
            kill(-mPgid, SIGCONT);
        }
        break; }
    case Background: {
        if (resume) {
            kill(-mPgid, SIGCONT);
        }
        break; }
    }
    mMode = m;
}

void Job::launch(Process* proc, int in, int out, int err, Mode m, bool is_interactive)
{
    if (is_interactive) {
        pid_t pid = getpid();
        if (mPgid == 0) mPgid = pid;
        setpgid(pid, mPgid);
        if (m == Foreground)
            tcsetpgrp(STDIN_FILENO, mPgid);
    }

    signal(SIGINT, SIG_DFL);
    signal(SIGQUIT, SIG_DFL);
    signal(SIGTSTP, SIG_DFL);
    signal(SIGTTIN, SIG_DFL);
    signal(SIGTTOU, SIG_DFL);
    signal(SIGCHLD, SIG_DFL);

    if (in != STDIN_FILENO) {
        dup2(in, STDIN_FILENO);
        ::close(in);
    }
    if (out != STDOUT_FILENO) {
        dup2(out, STDOUT_FILENO);
        ::close(out);
    }
    if (err != STDERR_FILENO) {
        dup2(err, STDERR_FILENO);
        ::close(err);
    }

    // build argv and envp
    const auto& args = proc->args();
    const auto& environ = proc->environ();

    const auto paths = split(get<std::string>(environ, "path"), ':');
    auto pathify = [&paths](const std::string& cmd) {
        if (cmd.empty())
            return cmd;
        if (cmd[0] == '/')
            return cmd;

        int r;
        struct stat st;
        for (auto p : paths) {
            auto cur = p + '/' + cmd;
            r = stat(cur.c_str(), &st);
            if (r == 0) {
                if ((st.st_mode & (S_IFREG|S_IXUSR)) == (S_IFREG|S_IXUSR)) {
                    // success
                    return cur;
                }
            }
        }
        return cmd;
    };

    const char** argv = reinterpret_cast<const char**>(malloc((args.size() + 2) * sizeof(char*)));
    argv[0] = strdup(proc->path().c_str());
    argv[args.size() + 1] = 0;
    int idx = 0;
    for (const std::string& arg : args) {
        argv[++idx] = strdup(arg.c_str());
    }
    char** envp = reinterpret_cast<char**>(malloc((environ.size() + 1) * sizeof(char*)));
    envp[environ.size()] = 0;
    idx = 0;
    for (const auto& env : environ) {
        envp[idx++] = strdup((env.first + "=" + env.second).c_str());
    }

    // we need to find proc->path() in $PATH
    const auto resolved = pathify(proc->path());

    // FILE* f = fopen("/tmp/jshproc.txt", "a");
    // fprintf(f, "going to run '%s'\n", resolved.c_str());
    // fclose(f);

    execve(resolved.c_str(), const_cast<char*const*>(argv), envp);

    // FILE* f2 = fopen("/tmp/jshproc.txt", "a");
    // fprintf(f2, "but failed miserably %d\n", errno);
    // fclose(f2);
}

void Job::start(Mode m, uint8_t fdmode)
{
    {
        mIoClosed.on([](const std::shared_ptr<Job>& job, Job::Io io) {
                    switch (io) {
                    case Job::Stdout:
                        if (job->mStdout != -1) {
                            ::close(job->mStdout);
                            job->mStdout = -1;
                        }
                        break;
                    case Job::Stderr:
                        if (job->mStderr != -1) {
                            ::close(job->mStderr);
                            job->mStderr = -1;
                        }
                        break;
                    }
                    if (job->isIoClosed()) {
                        if (job->mStdin != -1) {
                            ::close(job->mStdin);
                            job->mStdin = -1;
                        }
                        if (job->isTerminated()) {
                            job->stateChanged()(job, Job::Terminated, job->status());
                            // printf("erasing from jobs(2)\n");
                            sJobs.erase(job);
                        }
                    }
            });
    }

    sJobs.insert(shared_from_this());

    static bool is_interactive = isatty(STDIN_FILENO) != 0;

    int p[2] = { -1, -1 }, in = -1, out, lastout, err = -1;

    if (fdmode & DupStdin) {
        ::pipe(p);
        mStdin = p[1];
        in = p[0];
    } else {
        mStdin = -1;
        in = STDIN_FILENO;
    }

    if (fdmode & DupStderr) {
        ::pipe(p);
        mStderr = p[0];
        err = p[1];
    } else {
        mStderr = -1;
        err = STDERR_FILENO;
    }

    if (fdmode & DupStdout) {
        ::pipe(p);
        mStdout = p[0];
        lastout = p[1];
    } else {
        mStdout = -1;
        lastout = STDOUT_FILENO;
    }

    if (fdmode & (DupStdin|DupStdout|DupStderr))
        state.reader->add(shared_from_this());

    pid_t pid;
    Process* start = &mProcs[0];
    Process* proc = start;
    Process* end = proc + mProcs.size();
    while (proc != end) {
        if (proc + 1 != end) {
            ::pipe(p);
            out = p[1];
        } else {
            out = lastout;
        }

        // printf("forking\n");
        pid = fork();
        if (pid == 0) {
            // child
            if (mStdin != -1)
                ::close(mStdin);
            if (mStdout != -1)
                ::close(mStdout);
            if (mStderr != -1)
                ::close(mStderr);
            launch(proc, in, out, err, m, is_interactive);
        } else if (pid > 0) {
            // parent
            proc->mPid = pid;
            if (is_interactive) {
                if (!mPgid)
                    mPgid = pid;
                setpgid(pid, mPgid);
            }
        } else {
            // sad!
        }

        if (in != STDIN_FILENO)
            ::close(in);
        if (out != STDOUT_FILENO)
            ::close(out);

        in = p[0];
        ++proc;
    }
    if (in != mStdout && in != STDIN_FILENO)
        ::close(in);
    if (err != -1 && err != STDERR_FILENO)
        ::close(err);

    if (is_interactive)
        setMode(m, false);
}

void Job::terminate()
{
    if (!isTerminated())
        kill(-mPgid, SIGTERM);
}

void Job::init()
{
    state.reader.reset(new JobReader);
    state.waiter.reset(new JobWaiter);

    state.reader->start();
    state.waiter->start();
}

void Job::deinit()
{
    if (state.reader)
        state.reader->stop();
    state.reader.reset();
    if (state.waiter)
        state.waiter->stop();
    state.waiter.reset();
}

void Job::write(const uint8_t* data, size_t len)
{
    MutexLocker locker(&state.stdinMutex);
    mStdinBuffer.add(data, len);
}

void Job::close()
{
    {
        MutexLocker locker(&state.stdinMutex);
        mStdinClosed = true;
    }
    state.reader->wakeup();
}
