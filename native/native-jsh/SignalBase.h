#ifndef SIGNALBASE_H
#define SIGNALBASE_H

#include <unordered_set>
#include <uv.h>
#include "apply.h"

class SignalBase
{
public:
    SignalBase() { sBases.insert(this); }
    ~SignalBase() { sBases.erase(this); cleanup(); }

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
        Call(Functor&& f, std::tuple<Args...>&& a)
            : func(std::forward<Functor>(f)),
              args(std::forward<std::tuple<Args...> >(a))
        {
        }

        Call(Functor&& f, Args... args)
            : func(std::forward<Functor>(f)),
              args(args...)
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
        std::tuple<Args...> args;
    };

    void call(CallBase&& base) const
    {
        call(base.take());
    }
    void call(CallBase* base) const;

private:
    void cleanup();

private:
    uv_async_t mAsync;

    static std::unordered_set<SignalBase*> sBases;
};

#endif
