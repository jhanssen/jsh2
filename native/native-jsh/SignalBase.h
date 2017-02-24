#ifndef SIGNALBASE_H
#define SIGNALBASE_H

#include <unordered_set>
#include <uv.h>
#include "apply.h"

class SignalBase
{
public:
    SignalBase() { sBases.insert(this); }
    ~SignalBase() { sBases.erase(this); }

    static void init();
    static void deinit();

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
        Call(Functor&& f)
            : func(std::forward<Functor>(f))
        {
        }

        Call(Functor&& f, Args... args)
            : func(std::forward<Functor>(f)),
              args(std::make_tuple(args...))
        {
        }

        void setArgs(std::tuple<Args...>&& a)
        {
            args = std::forward<std::tuple<Args...> >(a);
        }

        virtual void call() override
        {
            apply(func, args);
        }

        virtual CallBase* take() override
        {
            auto taken = new Call<Functor, Args...>(std::move(func));
            taken->setArgs(std::move(args));
            return taken;
        }

        Functor func;
        std::tuple<Args...> args;
    };

    void call(CallBase&& base)
    {
        call(base.take());
    }
    void call(CallBase* base);

private:
    uv_async_t mAsync;

    static std::unordered_set<SignalBase*> sBases;
};

#endif
