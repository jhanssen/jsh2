#include "SignalBase.h"
#include "utils.h"
#include <unordered_map>

std::unordered_set<SignalBase*> SignalBase::sBases;

struct {
    Mutex mutex;
    std::unordered_map<uv_async_t*, std::vector<SignalBase::CallBase*> > calls;
} static state;

void SignalBase::init()
{
    auto func = [](uv_async_t* async) {
        std::vector<SignalBase::CallBase*> calls;
        {
            MutexLocker locker(&state.mutex);
            auto it = state.calls.find(async);
            if (it != state.calls.end())
                std::swap(it->second, calls);
        }
        for (auto c : calls) {
            c->call();
            delete c;
        }
    };

    for (SignalBase* base : sBases) {
        uv_async_init(uv_default_loop(), &base->mAsync, func);
    }
}

void SignalBase::deinit()
{
}

void SignalBase::call(CallBase* base)
{
    {
        MutexLocker locker(&state.mutex);
        state.calls[&mAsync].push_back(base);
    }
    uv_async_send(&mAsync);
}
