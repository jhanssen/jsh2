#ifndef JOB_H
#define JOB_H

#include "Process.h"
#include "Signal.h"
#include "Buffer.h"
#include <assert.h>
#include <vector>
#include <unordered_set>
#include <memory>
#include <unistd.h>

class JobWaiter;

class Job : public std::enable_shared_from_this<Job>
{
public:
    Job()
        : mPgid(0), mStdin(0), mStdout(0), mStderr(0),
          mStatus(0), mNotified(false), mStdinClosed(false), mMode(Foreground)
    {
    }

    ~Job()
    {
        assert(isTerminated());
        if (mStdin != -1)
            ::close(mStdin);
    }

    void add(Process&& proc) { mProcs.push_back(std::forward<Process>(proc)); }

    enum Mode { Foreground, Background };
    void setMode(Mode m, bool resume);

    enum FdMode { DupStdin = 0x1, DupStdout = 0x2, DupStderr = 0x4 };
    void start(Mode m, uint8_t fdmode = 0);
    void terminate();

    void write(const uint8_t* data, size_t len);
    void close();

    bool isStopped() const;
    bool isTerminated() const;
    bool isIoClosed() const { return mStdout == -1 && mStderr == -1; }

    void setStatus(int status) { mStatus = status; }
    int status() const { return mStatus; }

    std::string command() const { return mCommand; }

    static void init();
    static void deinit();

    enum State { Stopped, Terminated, Failed };
    enum Io { Stdout, Stderr };
    Signal<std::function<void(const std::shared_ptr<Job>&, State, int)> >& stateChanged() { return mStateChanged; }
    Signal<std::function<void(const std::shared_ptr<Job>&, Buffer&)> >& stdout() { return mStdoutSignal; }
    Signal<std::function<void(const std::shared_ptr<Job>&, Buffer&)> >& stderr() { return mStderrSignal; }
    Signal<std::function<void(const std::shared_ptr<Job>&, Io io)> >& ioClosed() { return mIoClosed; }

private:
    void updateState(Process& pid, int status);
    void launch(Process* proc, int in, int out, int err, int notif, Mode m, bool is_interactive);

private:
    std::string mCommand;
    std::vector<Process> mProcs;
    Buffer mStdinBuffer;
    pid_t mPgid;
    struct termios mTmodes;
    int mStdin, mStdout, mStderr;
    int mStatus;
    bool mNotified;
    bool mStdinClosed;
    Mode mMode;
    Signal<std::function<void(const std::shared_ptr<Job>&, State, int)> > mStateChanged;
    Signal<std::function<void(const std::shared_ptr<Job>&, Buffer&)> > mStdoutSignal, mStderrSignal;
    Signal<std::function<void(const std::shared_ptr<Job>&, Io io)> > mIoClosed;

    static std::unordered_set<std::shared_ptr<Job> > sJobs;

    friend class JobWaiter;
    friend class JobReader;
};

inline bool Job::isStopped() const
{
    for (const auto& p : mProcs) {
        switch (p.state()) {
        case Process::Created:
        case Process::Running:
            return false;
        default:
            break;
        }
    }
    return true;
}

inline bool Job::isTerminated() const
{
    for (const auto& p : mProcs) {
        switch (p.state()) {
        case Process::Created:
        case Process::Running:
        case Process::Stopped:
            return false;
        default:
            break;
        }
    }
    return true;
}

#endif
