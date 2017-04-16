#ifndef PROCESS_H
#define PROCESS_H

#include <unordered_map>
#include <vector>
#include <functional>
#include "Signal.h"

class Job;

class Process
{
public:
    typedef std::unordered_map<std::string, std::string> Environ;
    typedef std::vector<std::string> Args;
    struct Redirect
    {
        int fromfd, tofd;
        std::string file;
        bool append;
    };
    typedef std::vector<Redirect> Redirects;

    Process(const std::string& path)
        : mPath(path), mState(Created), mPid(0), mStatus(0)
    {
    }

    void setEnviron(Environ&& environ) { mEnviron = std::forward<Environ>(environ); }
    void setArgs(Args&& args) { mArgs = std::forward<Args>(args); }
    void setRedirects(Redirects&& redirs) { mRedirs = std::forward<Redirects>(redirs); }

    const std::string& path() const { return mPath; }
    const Environ& environ() const { return mEnviron; }
    const Args& args() const { return mArgs; }
    const Redirects& redirs() const { return mRedirs; }
    pid_t pid() const { return mPid; }
    int status() const { return mStatus; }

    enum State { Created, Running, Stopped, Terminated };
    State state() const { return mState; }

    Signal<std::function<void(Process*, State)> >& stateChanged() { return mStateChanged; }

private:
    std::string mPath;
    Environ mEnviron;
    Args mArgs;
    Redirects mRedirs;
    State mState;
    pid_t mPid;
    int mStatus;

    Signal<std::function<void(Process*, State)> > mStateChanged;

    friend class Job;
};

#endif
