#ifndef SIGNAL_H
#define SIGNAL_H

#include <unordered_map>
#include <tuple>
#include "SignalBase.h"
#include "utils.h"

template<typename Functor>
class Signal : protected SignalBase
{
public:
    typedef uint32_t Key;

    enum Mode { Direct, Posted };
    Signal(Mode m = Posted);

    Key on(Functor&& func);
    bool off(Key key);
    void off();

    template<typename... Args>
    void operator()(Args&&... args) const;

private:
    std::unordered_map<Key, Functor> mFuncs;
    Mode mMode;
    Key mNextKey;

    // this should possibly be static,
    // bit of a waste to have one mutex per signal
    mutable Mutex mMutex;
};

template<typename Functor>
Signal<Functor>::Signal(Mode m)
    : mMode(m), mNextKey()
{
}

template<typename Functor>
typename Signal<Functor>::Key Signal<Functor>::on(Functor&& func)
{
    MutexLocker locker(&mMutex);
    Key k = mNextKey++;
    mFuncs[k] = std::forward<Functor>(func);
    return k;
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
void Signal<Functor>::off()
{
    MutexLocker locker(&mMutex);
    mFuncs.clear();
}

template<typename Functor>
template<typename... Args>
void Signal<Functor>::operator()(Args&&... args) const
{
    std::unordered_map<Key, Functor> funcs;
    Mode mode;
    {
        MutexLocker locker(&mMutex);
        mode = mMode;
        funcs = mFuncs;
    }
    if (mode == Posted && !isLoopThread()) {
        for (auto& f : funcs) {
            call(SignalBase::Call<Functor, Args...>(std::move(f.second), std::forward<Args>(args)...));
        }
    } else {
        for (auto& f : funcs) {
            std::tuple<typename std::remove_reference<Args>::type...> tup(std::forward<Args>(args)...);
            apply(tup, f.second);
        }
    }
}

#endif
