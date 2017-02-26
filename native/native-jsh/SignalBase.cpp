#include "SignalBase.h"
#include "utils.h"
#include <unordered_map>

struct {
    Mutex mutex;
    std::unordered_map<const SignalBase*, std::vector<SignalBase::CallBase*> > calls;

    uv_async_t async;
    uv_thread_t mainThread;
} static state;

void SignalBase::init()
{
    MutexLocker locker(&state.mutex);
    state.mainThread = uv_thread_self();
    uv_async_init(uv_default_loop(), &state.async, [](uv_async_t*) {
            std::unordered_map<const SignalBase*, std::vector<SignalBase::CallBase*> > calls;
            {
                MutexLocker locker(&state.mutex);
                std::swap(state.calls, calls);
            }

            auto base = calls.begin();
            const auto end = calls.cend();
            while (base != end) {
                for (const auto& c : base->second) {
                    c->call();
                    delete c;
                }
                ++base;
            }
        });
}

void SignalBase::deinit()
{
}

void SignalBase::removeBase(SignalBase* base)
{
    MutexLocker locker(&state.mutex);
    state.calls.erase(base);
}

bool SignalBase::isLoopThread()
{
    const auto self = uv_thread_self();
    return uv_thread_equal(&self, &state.mainThread);
}

void SignalBase::call(CallBase* base) const
{
    {
        MutexLocker locker(&state.mutex);
        state.calls[this].push_back(base);
    }
    uv_async_send(const_cast<uv_async_t*>(&state.async));
}
