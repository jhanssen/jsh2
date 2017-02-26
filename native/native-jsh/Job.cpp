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

    void add(const std::shared_ptr<Job>& job, int out, int err)
    {
        // make read pipes non-blocking
        int r = fcntl(out, F_GETFL);
        fcntl(out, F_SETFL, r | O_NONBLOCK);

        r = fcntl(err, F_GETFL);
        fcntl(err, F_SETFL, r | O_NONBLOCK);

        MutexLocker locker(&mMutex);
        mReads.insert(std::make_pair(job, std::make_pair(out, err)));
        wakeup();
    }

    void remove(const std::shared_ptr<Job>& job)
    {
        MutexLocker locker(&mMutex);
        mReads.erase(job);
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

    std::map<std::weak_ptr<Job>, std::pair<int, int>, std::owner_less<std::weak_ptr<Job> > > mReads;
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

    fd_set rdset;
    for (;;) {
        // select on everything
        FD_ZERO(&rdset);
        FD_SET(mPipe[0], &rdset);
        int max = mPipe[0];
        // add the rest
        {
            MutexLocker locker(&mMutex);
            if (mStopped)
                break;

            for (const auto& r : mReads) {
                FD_SET(r.second.first, &rdset);
                if (r.second.first > max)
                    max = r.second.first;
                FD_SET(r.second.second, &rdset);
                if (r.second.second > max)
                    max = r.second.second;
            }
        }
        int r = ::select(max + 1, &rdset, 0, 0, 0);
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
                for (const auto& r : mReads) {
                    bool handled = true;
                    if (FD_ISSET(r.second.first, &rdset)) {
                        handled = false;
                        if (std::shared_ptr<Job> job = r.first.lock()) {
                            if (handleRead(job, r.second.first, buffer)) {
                                handled = true;
                                job->stdout()(job, buffer);
                                buffer.clear();
                            }
                        }
                    }
                    if (FD_ISSET(r.second.second, &rdset)) {
                        handled = false;
                        if (std::shared_ptr<Job> job = r.first.lock()) {
                            if (handleRead(job, r.second.second, buffer)) {
                                handled = true;
                                job->stderr()(job, buffer);
                                buffer.clear();
                            }
                        }
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
                                job->terminated()(job);
                                // and die
                                dead.push_back(job);
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
                state.reader->remove(job);
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

    const char** argv = reinterpret_cast<const char**>(malloc((args.size() + 1) * sizeof(char*)));
    argv[args.size()] = 0;
    int idx = 0;
    for (const std::string& arg : args) {
        argv[idx++] = arg.c_str();
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

    state.reader->add(shared_from_this(), mStdout, mStderr);

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
            launch(proc, in, err, out, m, is_interactive);
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
