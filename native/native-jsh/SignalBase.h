#ifndef SIGNALBASE_H
#define SIGNALBASE_H

#include <unordered_set>
#include <uv.h>
#include "apply.h"

class SignalBase
{
public:
    SignalBase() { }
    ~SignalBase() { removeBase(this); }

    static void init();
    static void deinit();

    static bool isLoopThread();

    struct CallBase
    {
        virtual ~CallBase() { }

        virtual void call() = 0;
        virtual CallBase* take() = 0;
    };

protected:
    template<typename Functor, typename... Args>
    struct Call : public CallBase
    {
    public:
        typedef std::tuple<typename std::remove_reference<Args>::type...> Decayed;

        Call(Functor&& f, Decayed&& a)
            : func(std::forward<Functor>(f)),
              args(std::forward<Decayed>(a))
        {
        }

        Call(Functor&& f, Args... a)
            : func(std::forward<Functor>(f)),
              args(std::forward<Args>(a)...)
        {
        }

        virtual void call() override
        {
            apply(args, func);
        }

        virtual CallBase* take() override
        {
            auto taken = new Call<Functor, Args...>(std::move(func), std::move(args));
            return taken;
        }

        Functor func;
        Decayed args;
    };

    void call(CallBase&& base) const
    {
        call(base.take());
    }
    void call(CallBase* base) const;

private:
    static void removeBase(SignalBase* base);
};

#endif
