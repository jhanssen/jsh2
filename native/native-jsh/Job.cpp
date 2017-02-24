#include "Job.h"
#include "utils.h"
#include <uv.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unordered_map>

std::unordered_set<Job*> Job::sJobs;

// we're going to need a thread that reads the out/err of the final process in our jobs

class JobReader
{
public:
    JobReader()
    {
        ::pipe(mPipe);
    }
    ~JobReader()
    {
        ::close(mPipe[0]);
        ::close(mPipe[1]);
    }

    void add(Job* job, int out, int err)
    {
        MutexLocker locker(&mMutex);
        mReads.insert(std::make_pair(job, std::make_pair(out, err)));
        wakeup();
    }

    void remove(Job* job)
    {
        MutexLocker locker(&mMutex);
        mReads.erase(job);
    }

    void start()
    {
        uv_thread_create(&mThread, JobReader::run, this);
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

    std::unordered_map<Job*, std::pair<int, int> > mReads;
};

void JobReader::wakeup()
{
    int e;
    char c = 'w';
    EINTRWRAP(e, ::write(mPipe[1], &c, 1));
}

void JobReader::run()
{
}

// we also need to handle SIGCHLD

class JobWaiter
{
public:
    JobWaiter() { }
    ~JobWaiter() { }

    void start();

private:
    uv_signal_t mHandler;

    static uv_async_t sAsync;
};

void JobWaiter::start()
{
    uv_async_init(uv_default_loop(), &sAsync, [](uv_async_t*) {
            int status;
            std::vector<Job*> dead;
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
                        }
                    }
                    continue;
                }
                break;
            }
            for (auto job : dead) {
                delete job;
            }
        });

    uv_signal_init(uv_default_loop(), &mHandler);
    uv_signal_start(&mHandler, [](uv_signal_t*, int) {
            uv_async_send(&sAsync);
        }, SIGCHLD);
}

struct {
    JobReader reader;
    JobWaiter waiter;
} static state;

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

    execvpe(proc->path().c_str(), const_cast<char*const*>(argv), envp);
}

void Job::start(Mode m)
{
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

    state.reader.add(this, mStdout, mStderr);

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
    state.reader.remove(this);
}

void Job::init()
{
    state.reader.start();
    state.waiter.start();
}

void Job::deinit()
{
}
