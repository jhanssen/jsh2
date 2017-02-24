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

    Process(const std::string& path);

    void setEnviron(Environ&& environ);
    void setArgs(Args&& args);

    const std::string& path() const { return mPath; }
    const Environ& environ() const { return mEnviron; }
    const Args& args() const { return mArgs; }

    enum State { Created, Running, Stopped, Terminated };
    State state() const { return mState; }

    Signal<std::function<void(Process*, State)> >& subscribe() { return mSubscribe; }

private:
    std::string mPath;
    Environ mEnviron;
    Args mArgs;
    State mState;

    Signal<std::function<void(Process*, State)> > mSubscribe;
};

#endif
