#include <nan.h>
#include <unistd.h>
#include <signal.h>
#include "Job.h"
#include "Process.h"
#include "SignalBase.h"

struct {
    pid_t pid, pgid;
    bool is_interactive;
    struct termios tmodes;
} static state;

NAN_METHOD(init) {
    // check state, wait for foreground if needed and return an object telling JS about our state

    state.pid = getpid();
    state.is_interactive = isatty(STDIN_FILENO) != 0;
    if (state.is_interactive) {
        while (tcgetpgrp(STDIN_FILENO) != (state.pgid = getpgrp()))
            kill(state.pid, SIGTTIN);

        setpgid(state.pid, state.pid);
        state.pgid = getpgrp();
        if (state.pgid != state.pid) {
            // more badness
            Nan::ThrowError("Unable to set process as group leader");
            return;
        }

        if (tcsetpgrp(STDIN_FILENO, state.pgid) == -1) {
            Nan::ThrowError("Unable to set process group for terminal");
            return;
        }
        if (tcgetattr(STDIN_FILENO, &state.tmodes) == -1) {
            Nan::ThrowError("Unable to get terminal attributes for terminal");
            return;
        }
    } else {
        state.pgid = getpgrp();
    }

    SignalBase::init();
    Job::init();

    auto obj = Nan::New<v8::Object>();
    Nan::Set(obj, Nan::New<v8::String>("pid").ToLocalChecked(), Nan::New<v8::Int32>(state.pid));
    Nan::Set(obj, Nan::New<v8::String>("pgid").ToLocalChecked(), Nan::New<v8::Int32>(state.pgid));
    Nan::Set(obj, Nan::New<v8::String>("interactive").ToLocalChecked(), Nan::New<v8::Boolean>(state.is_interactive));

    info.GetReturnValue().Set(obj);
}

NAN_METHOD(deinit) {
    Job::deinit();
}

NAN_METHOD(restore) {
    if (!state.is_interactive) {
        Nan::ThrowError("Can't restore state for non-interactive shell");
        return;
    }
    if (tcsetpgrp(STDIN_FILENO, state.pgid) == -1) {
        Nan::ThrowError("Unable to set process group for terminal");
        return;
    }
    int mode = TCSADRAIN;
    if (info.Length() > 0 && info[0]->IsString()) {
        const std::string str = *Nan::Utf8String(info[0]);
        if (str == "now") {
            mode = TCSANOW;
        } else if (str == "drain") {
            mode = TCSADRAIN;
        } else if (str == "flush") {
            mode = TCSAFLUSH;
        } else {
            Nan::ThrowError("Invalid mode for restore");
            return;
        }
    }

    if (tcsetattr(STDIN_FILENO, mode, &state.tmodes) == -1) {
        Nan::ThrowError("Unable to set terminal attributes for terminal");
        return;
    }
}

namespace job {
class NanJob : public Nan::ObjectWrap
{
public:
    NanJob(std::shared_ptr<Job>&& j)
        : job(std::move(j))
    {
    }

    void Wrap(const v8::Local<v8::Object>& object)
    {
        Nan::ObjectWrap::Wrap(object);
    }

    std::shared_ptr<Job> job;
};

NAN_METHOD(New) {
    if (!info.IsConstructCall()) {
        Nan::ThrowError("Need to instantiate Job through new()");
        return;
    }

    auto job = new NanJob(std::shared_ptr<Job>(new Job));
    job->Wrap(info.This());
}

NAN_METHOD(Add) {
    printf("adding thing to job\n");
    auto job = Nan::ObjectWrap::Unwrap<NanJob>(info.Holder())->job;
}
}

NAN_MODULE_INIT(Initialize) {
    NAN_EXPORT(target, init);
    NAN_EXPORT(target, deinit);
    NAN_EXPORT(target, restore);

    {
        auto cname = Nan::New("Job").ToLocalChecked();
        auto ctor = Nan::New<v8::FunctionTemplate>(job::New);
        auto ctorInst = ctor->InstanceTemplate();
        ctor->SetClassName(cname);
        ctorInst->SetInternalFieldCount(1);

        Nan::SetPrototypeMethod(ctor, "add", job::Add);

        Nan::Set(target, cname, Nan::GetFunction(ctor).ToLocalChecked());
    }
}

NODE_MODULE(nativeJsh, Initialize)
