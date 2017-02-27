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

        // make read pipes non-blocking
        int r = fcntl(data.stdin, F_GETFL);
        fcntl(data.stdin, F_SETFL, r | O_NONBLOCK);

        r = fcntl(data.stdout, F_GETFL);
        fcntl(data.stdout, F_SETFL, r | O_NONBLOCK);

        r = fcntl(data.stderr, F_GETFL);
        fcntl(data.stderr, F_SETFL, r | O_NONBLOCK);

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

private:
    void run();
    void wakeup();

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
    auto handleRead = [](const std::shared_ptr<Job>& weak, int fd, Buffer& buffer) -> bool {
        int e;
        uint8_t buf[32768];
        for (;;) {
            EINTRWRAP(e, ::read(fd, buf, sizeof(buf)));
            if (e == -1) {
                if (errno == EAGAIN || errno == EWOULDBLOCK)
                    return true;
                return false;
            }
            if (e == 0) {
                // weird
                return false;
            }

            buffer.add(buf, e);
        }
        return false;
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
                FD_SET(jobdata.stdin, &rdset);
                if (jobdata.stdin > max)
                    max = jobdata.stdin;
                FD_SET(jobdata.stdout, &rdset);
                if (jobdata.stdout > max)
                    max = jobdata.stdout;
                if (jobdata.needsWrite) {
                    jobdata.needsWrite = false;
                    if (std::shared_ptr<Job> job = r.first.lock()) {
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
                                    break;
                                }
                            }
                            EINTRWRAP(e, ::write(jobdata.stdin, &data[0] + dataOff, dataRem));
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
                    }
                }
                if (!jobdata.pendingWrite.empty()) {
                    wrset = &actualwrset;
                    FD_ZERO(&actualwrset);
                    FD_SET(jobdata.stdin, &actualwrset);
                    if (jobdata.stdin > max)
                        max = jobdata.stdin;
                }
            }
            for (const auto j : bad) {
                mReads.erase(j);
            }
        }
        int r = ::select(max + 1, &rdset, wrset, 0, 0);
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
                    if (FD_ISSET(jobdata.stdout, &rdset)) {
                        handled = false;
                        if (std::shared_ptr<Job> job = r.first.lock()) {
                            if (handleRead(job, jobdata.stdout, buffer)) {
                                handled = true;
                                job->stdout()(job, std::move(buffer));
                                buffer.clear();
                            }
                        }
                    }
                    if (FD_ISSET(jobdata.stderr, &rdset)) {
                        handled = false;
                        if (std::shared_ptr<Job> job = r.first.lock()) {
                            if (handleRead(job, jobdata.stderr, buffer)) {
                                handled = true;
                                job->stderr()(job, std::move(buffer));
                                buffer.clear();
                            }
                        }
                    }
                    if (wrset && FD_ISSET(jobdata.stdin, wrset)) {
                        jobdata.needsWrite = true;
                    }
                    if (!handled) {
                        // bad job, take it out
                        bad.push_back(r.first);
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
            int status;
            std::vector<std::shared_ptr<Job> > dead;
            for (;;) {
                const pid_t w = waitpid(-1, &status, WNOHANG | WUNTRACED);
                if (w > 0) {
                    for (auto job : Job::sJobs) {
                        if (job->checkState(w, status)) {
                            if (job->isTerminated()) {
                                // if our job is completely done we should notify someone(tm)
                                job->stateChanged()(job, Job::Terminated);
                                // and die
                                dead.push_back(job);
                            } else if (job->isStopped()) {
                                job->stateChanged()(job, Job::Stopped);
                            }
                            break;
                        } else {
                            // bad
                            break;
                        }
                    }
                    continue;
                }
                break;
            }
            for (auto job : dead) {
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

bool Job::checkState(pid_t pid, int status)
{
    for (auto& proc : mProcs) {
        if (proc.pid() == pid) {
            // stuff
            proc.mStatus = status;
            if (WIFSTOPPED(status)) {
                proc.mState = Process::Stopped;
            } else {
                proc.mState = Process::Terminated;
            }
            proc.stateChanged()(&proc, proc.mState);
            return true;
        }
    }
    return false;
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
            tcsetattr(STDIN_FILENO, TCSADRAIN, &mTmodes);
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

    dup2(in, STDIN_FILENO);
    dup2(out, STDOUT_FILENO);
    dup2(err, STDERR_FILENO);
    close(in);
    close(out);
    close(err);

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
    argv[0] = proc->path().c_str();
    argv[args.size() + 1] = 0;
    int idx = 0;
    for (const std::string& arg : args) {
        argv[++idx] = arg.c_str();
    }
    char** envp = reinterpret_cast<char**>(malloc((environ.size() + 1) * sizeof(char*)));
    idx = 0;
    for (const auto& env : environ) {
        envp[idx++] = strdup((env.first + "=" + env.second).c_str());
    }

    // we need to find proc->path() in $PATH
    execve(pathify(proc->path()).c_str(), const_cast<char*const*>(argv), envp);
}

void Job::start(Mode m)
{
    sJobs.insert(shared_from_this());

    static bool is_interactive = isatty(STDIN_FILENO) != 0;

    int p[2], in, out, lastout, err;
    ::pipe(p);
    mStdin = p[1];
    in = p[0];

    ::pipe(p);
    mStderr = p[0];
    err = p[1];

    ::pipe(p);
    mStdout = p[0];
    lastout = p[1];

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

        pid = fork();
        if (pid == 0) {
            // child
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

        if (proc != start)
            close(in);
        if (out != lastout)
            close(out);
        in = p[0];
        ++proc;
    }

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
