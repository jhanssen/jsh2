#include <nan.h>
#include <unistd.h>
#include <signal.h>
#include "Job.h"
#include "Process.h"
#include "SignalBase.h"

using std::bind;
using std::placeholders::_1;
using std::placeholders::_2;
using std::placeholders::_3;

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
        : job(std::move(j)), id(nextId++)
    {
        auto onout = [](const auto& /*job*/, auto& buffer, auto cb) {
            Nan::HandleScope scope;
            auto data = buffer.readAll();
            auto nodeBuffer = v8::Local<v8::Value>::Cast(Nan::CopyBuffer(reinterpret_cast<char*>(&data[0]), data.size()).ToLocalChecked());
            if (!cb->IsEmpty())
                cb->Call(1, &nodeBuffer);
        };

        // apparently we can't bind Nan::Callback as value
        job->stdout().on(bind(onout, _1, _2, &onStdOut));
        job->stderr().on(bind(onout, _1, _2, &onStdErr));

        job->stateChanged().on(bind([](const auto& job, auto state, auto cb) {
                    Nan::HandleScope scope;
                    auto nodeState = v8::Local<v8::Value>::Cast(Nan::New<v8::Uint32>(state));
                    if (!cb->IsEmpty())
                        cb->Call(1, &nodeState);
                }, _1, _2, &onStateChanged));
    }
    ~NanJob()
    {
        job->stdout().off();
        job->stderr().off();
        job->stateChanged().off();
    }

    void Wrap(const v8::Local<v8::Object>& object)
    {
        Nan::ObjectWrap::Wrap(object);
    }

    std::shared_ptr<Job> job;
    uint32_t id;

    Nan::Callback onStdOut, onStdErr, onStateChanged;

    static uint32_t nextId;
};

uint32_t NanJob::nextId = 0;

NAN_METHOD(New) {
    if (!info.IsConstructCall()) {
        Nan::ThrowError("Need to instantiate Job through new()");
        return;
    }

    // SignalBase::init();
    // Job::init();

    auto job = new NanJob(std::shared_ptr<Job>(new Job));

    auto thiz = info.This();
    Nan::Set(thiz, Nan::New("id").ToLocalChecked(), Nan::New<v8::Uint32>(job->id));

    job->Wrap(thiz);
}

NAN_METHOD(Start) {
    auto job = Nan::ObjectWrap::Unwrap<NanJob>(info.Holder())->job;
    Job::Mode m = Job::Foreground;
    if (info.Length() > 0) {
        if (!info[0]->IsUint32()) {
            Nan::ThrowError("Job.start takes a mode (number) argument");
            return;
        }
        const uint32_t mm = v8::Local<v8::Uint32>::Cast(info[0])->Value();
        switch (mm) {
        case Job::Foreground:
            m = Job::Foreground;
            break;
        case Job::Background:
            m = Job::Background;
            break;
        default:
            Nan::ThrowError("Job.start takes a mode argument");
            return;
        }
    }
    job->start(m);
}

NAN_METHOD(Add) {
    if (info.Length() < 1 || !info[0]->IsObject()) {
        Nan::ThrowError("Job.add takes an object argument");
        return;
    }
    // extract the relevant parts of our process argument

    // path is required, environ and args are optional
    auto obj = v8::Local<v8::Object>::Cast(info[0]);
    auto maybePath = Nan::Get(obj, Nan::New("path").ToLocalChecked());
    if (maybePath.IsEmpty()) {
        Nan::ThrowError("Job.add needs a path");
        return;
    }
    auto path = maybePath.ToLocalChecked();
    if (!path->IsString()) {
        Nan::ThrowError("Job.add path needs to be a string");
        return;
    }

    Process proc(*Nan::Utf8String(path));

    auto maybeArgs = Nan::Get(obj, Nan::New("args").ToLocalChecked());
    if (!maybeArgs.IsEmpty()) {
        auto args = maybeArgs.ToLocalChecked();
        if (args->IsArray()) {
            auto argsArray = v8::Local<v8::Array>::Cast(args);
            Process::Args procArgs;
            for (uint32_t i = 0; i < argsArray->Length(); ++i) {
                if (!argsArray->Get(i)->IsString()) {
                    Nan::ThrowError("Job.add args elements needs to be strings");
                    return;
                }
                procArgs.push_back(*Nan::Utf8String(argsArray->Get(i)));
            }
            proc.setArgs(std::move(procArgs));
        }
    }

    auto maybeEnviron = Nan::Get(obj, Nan::New("environ").ToLocalChecked());
    if (!maybeEnviron.IsEmpty()) {
        auto environ = maybeEnviron.ToLocalChecked();
        if (environ->IsObject()) {
            auto environObject = v8::Local<v8::Object>::Cast(environ);
            auto maybeProps = Nan::GetOwnPropertyNames(environObject);
            if (maybeProps.IsEmpty()) {
                Nan::ThrowError("Job.add environ can't get properties");
                return;
            }
            auto props = maybeProps.ToLocalChecked();
            if (!props->IsArray()) {
                // seems impossible?
                Nan::ThrowError("Job.add environ props is not an array");
                return;
            }
            Process::Environ procEnviron;
            auto propsArray = v8::Local<v8::Array>::Cast(props);
            for (uint32_t i = 0; i < propsArray->Length(); ++i) {
                auto val = environObject->Get(propsArray->Get(i));
                procEnviron[*Nan::Utf8String(propsArray->Get(i))] = *Nan::Utf8String(val);
            }
            proc.setEnviron(std::move(procEnviron));
        }
    }

    auto job = Nan::ObjectWrap::Unwrap<NanJob>(info.Holder())->job;
    job->add(std::move(proc));
}

NAN_METHOD(Write) {
    auto job = Nan::ObjectWrap::Unwrap<NanJob>(info.Holder())->job;
    if (info.Length() >= 1) {
        if (info[0]->IsString()) {
            Nan::Utf8String str(info[0]);
            job->write(reinterpret_cast<uint8_t*>(*str), str.length());
        } else if (info[0]->IsObject() && node::Buffer::HasInstance(info[0])) {
            auto data = node::Buffer::Data(info[0]);
            auto len = node::Buffer::Length(info[0]);
            job->write(reinterpret_cast<uint8_t*>(data), len);
        } else {
            Nan::ThrowError("Job.write invalid argument");
        }
    } else {
        Nan::ThrowError("Job.write takes a string or buffer argument");
    }
}

NAN_METHOD(On) {
    auto job = Nan::ObjectWrap::Unwrap<NanJob>(info.Holder());
    if (info.Length() >= 2 && info[0]->IsString() && info[1]->IsFunction()) {
        const std::string str = *Nan::Utf8String(info[0]);
        if (str == "stdout") {
            job->onStdOut.Reset(v8::Local<v8::Function>::Cast(info[1]));
        } else if (str == "stderr") {
            job->onStdErr.Reset(v8::Local<v8::Function>::Cast(info[1]));
        } else if (str == "stateChanged") {
            job->onStateChanged.Reset(v8::Local<v8::Function>::Cast(info[1]));
        } else {
            Nan::ThrowError("Invalid Job.on: " + str);
        }
    } else {
        Nan::ThrowError("Invalid arguments to Job.on");
    }
}

} // namespace job

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
        Nan::SetPrototypeMethod(ctor, "on", job::On);
        Nan::SetPrototypeMethod(ctor, "start", job::Start);
        Nan::SetPrototypeMethod(ctor, "write", job::Write);

        auto ctorFunc = Nan::GetFunction(ctor).ToLocalChecked();
        Nan::Set(ctorFunc, Nan::New("Foreground").ToLocalChecked(), Nan::New<v8::Uint32>(Job::Foreground));
        Nan::Set(ctorFunc, Nan::New("Background").ToLocalChecked(), Nan::New<v8::Uint32>(Job::Background));

        Nan::Set(target, cname, Nan::GetFunction(ctor).ToLocalChecked());
    }
}

NODE_MODULE(nativeJsh, Initialize)
