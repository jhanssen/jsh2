#ifndef SIGNAL_H
#define SIGNAL_H

#include <unordered_map>
#include "SignalBase.h"
#include "utils.h"

template<typename Functor>
class Signal : protected SignalBase
{
public:
    typedef uint32_t Key;

    Signal();

    Key on(Functor&& func);
    bool off(Key key);

    template<typename... Args>
    void operator()(Args&&... args) const;

private:
    std::unordered_map<Key, Functor> mFuncs;
    Key mNextKey;

    // this should possibly be static,
    // bit of a waste to have one mutex per signal
    Mutex mMutex;
};

template<typename Functor>
Signal<Functor>::Signal()
    : mNextKey()
{
}

template<typename Functor>
typename Signal<Functor>::Key Signal<Functor>::on(Functor&& func)
{
    MutexLocker locker(&mMutex);
    mFuncs[mNextKey++] = std::forward<Functor>(func);
}

template<typename Functor>
bool Signal<Functor>::off(Key key)
{
    MutexLocker locker(&mMutex);
    auto it = mFuncs.find(key);
    if (it == mFuncs.end())
        return false;
    mFuncs.erase(it);
    return true;
}

template<typename Functor>
template<typename... Args>
void Signal<Functor>::operator()(Args&&... args) const
{
    MutexLocker locker(&mMutex);
    for (const auto& f : mFuncs) {
        call(SignalBase::Call<Functor, Args...>(f, std::forward<Args>(args)...));
    }
}

#endif
