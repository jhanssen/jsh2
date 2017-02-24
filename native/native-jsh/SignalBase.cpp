#include "SignalBase.h"
#include "utils.h"
#include <unordered_map>

std::unordered_set<SignalBase*> SignalBase::sBases;

struct {
    Mutex mutex;
    std::unordered_map<const uv_async_t*, std::vector<SignalBase::CallBase*> > calls;

    uv_thread_t mainThread;
} static state;

void SignalBase::init()
{
    state.mainThread = uv_thread_self();

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

bool SignalBase::isLoopThread()
{
    const auto self = uv_thread_self();
    return uv_thread_equal(&self, &state.mainThread);
}

void SignalBase::cleanup()
{
    MutexLocker locker(&state.mutex);
    state.calls.erase(&mAsync);
}

void SignalBase::call(CallBase* base) const
{
    {
        MutexLocker locker(&state.mutex);
        state.calls[&mAsync].push_back(base);
    }
    uv_async_send(const_cast<uv_async_t*>(&mAsync));
}
