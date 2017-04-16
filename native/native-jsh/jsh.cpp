#include <nan.h>
#include <unistd.h>
#include <signal.h>
#include <pwd.h>
#include <sys/types.h>
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

        signal(SIGTSTP, SIG_IGN);
        signal(SIGTTIN, SIG_IGN);
        signal(SIGTTOU, SIG_IGN);

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

NAN_METHOD(users) {
    std::vector<v8::Local<v8::Object> > objs;

    struct passwd* entry;
    for (;;) {
        entry = getpwent();
        if (!entry) {
            endpwent();
            break;
        }
        auto obj = Nan::New<v8::Object>();
        obj->Set(Nan::New("name").ToLocalChecked(), Nan::New(entry->pw_name).ToLocalChecked());
        obj->Set(Nan::New("uid").ToLocalChecked(), Nan::New<v8::Uint32>(entry->pw_uid));
        obj->Set(Nan::New("gid").ToLocalChecked(), Nan::New<v8::Uint32>(entry->pw_gid));
        obj->Set(Nan::New("dir").ToLocalChecked(), Nan::New(entry->pw_dir).ToLocalChecked());
        obj->Set(Nan::New("shell").ToLocalChecked(), Nan::New(entry->pw_shell).ToLocalChecked());
        objs.push_back(std::move(obj));
    }

    auto ret = Nan::New<v8::Array>(objs.size());
    uint32_t idx = 0;
    auto obj = objs.cbegin();
    const auto end = objs.cend();
    while (obj != end) {
        ret->Set(idx, std::move(*obj));
        ++obj;
        ++idx;
    }
    info.GetReturnValue().Set(ret);
}

namespace job {

class NanJob : public Nan::ObjectWrap
{
public:
    NanJob(std::shared_ptr<Job>&& j)
        : job(std::move(j)), id(nextId++)
    {
        dead = std::make_shared<int>();
        std::weak_ptr<int> weak = dead;
        auto onout = [weak](const auto& /*job*/, auto& buffer, auto cb) {
            if (std::shared_ptr<int> d = weak.lock()) {
                Nan::HandleScope scope;
                auto data = buffer.readAll();
                auto nodeBuffer = v8::Local<v8::Value>::Cast(Nan::CopyBuffer(reinterpret_cast<char*>(&data[0]), data.size()).ToLocalChecked());
                if (!cb->IsEmpty())
                    cb->Call(1, &nodeBuffer);
            }
        };

        // apparently we can't bind Nan::Callback as value
        job->stdout().on(bind(onout, _1, _2, &onStdOut));
        job->stderr().on(bind(onout, _1, _2, &onStdErr));

        job->stateChanged().on(bind([weak, this](const auto& job, auto state, int status, auto cbs) {
                    if (std::shared_ptr<int> d = weak.lock()) {
                        Nan::HandleScope scope;
                        for (auto cb : *cbs) {
                            if (!cb->IsEmpty()) {
                                std::vector<v8::Local<v8::Value> > ret;
                                ret.push_back(v8::Local<v8::Value>::Cast(Nan::New<v8::Uint32>(state)));
                                ret.push_back(v8::Local<v8::Value>::Cast(Nan::New<v8::Int32>(status)));
                                cb->Call(ret.size(), &ret[0]);
                            }
                        }
                        if (state == Job::Terminated)
                            this->job.reset();
                    }
                }, _1, _2, _3, &onStateChanged));
    }
    ~NanJob()
    {
        if (job) {
            job->stdout().off();
            job->stderr().off();
            job->stateChanged().off();
        }
    }

    void Wrap(const v8::Local<v8::Object>& object)
    {
        Nan::ObjectWrap::Wrap(object);
    }

    // hack, we can capture a weak of this to determine if we're destroyed
    std::shared_ptr<int> dead;

    std::shared_ptr<Job> job;
    uint32_t id;

    Nan::Callback onStdOut, onStdErr;
    std::vector<std::shared_ptr<Nan::Callback> > onStateChanged;

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
    auto job = Nan::ObjectWrap::Unwrap<NanJob>(info.Holder());
    Job::Mode m = Job::Foreground;
    uint8_t dupmode = 0;
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
    if (info.Length() > 1) {
        if (!info[1]->IsUint32()) {
            Nan::ThrowError("Job.start takes a dupmode (number) argument");
            return;
        }
        const uint32_t dm = v8::Local<v8::Uint32>::Cast(info[1])->Value();
        if (dm > std::numeric_limits<uint8_t>::max()) {
            Nan::ThrowError("Job.start dupmode out of range");
            return;
        }
        dupmode = static_cast<uint8_t>(dm);
    }
    if (m == Job::Background) {
        if (!(dupmode & Job::DupStdout) && !job->onStdOut.IsEmpty())
            dupmode |= Job::DupStdout;
        if (!(dupmode & Job::DupStderr) && !job->onStdErr.IsEmpty())
            dupmode |= Job::DupStderr;
    }
    job->job->start(m, dupmode);
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

    auto maybeRedirs = Nan::Get(obj, Nan::New("redirs").ToLocalChecked());
    if (!maybeRedirs.IsEmpty()) {
        auto redirs = maybeRedirs.ToLocalChecked();
        if (redirs->IsArray()) {
            auto redirsArray = v8::Local<v8::Array>::Cast(redirs);
            Process::Redirects procRedirs;

            const auto ioKey = Nan::New("io").ToLocalChecked();
            const auto opKey = Nan::New("op").ToLocalChecked();
            const auto fileKey = Nan::New("file").ToLocalChecked();

            for (uint32_t i = 0; i < redirsArray->Length(); ++i) {
                auto redir = redirsArray->Get(i);
                if (!redir->IsObject()) {
                    Nan::ThrowError("Job.add redirect needs to be an object");
                    return;
                }
                auto redirObj = v8::Local<v8::Object>::Cast(redir);
                if (!redirObj->Has(opKey) || !redirObj->Has(fileKey)) {
                    Nan::ThrowError("Job.add invalid redirect");
                    return;
                }
                auto opVal = redirObj->Get(opKey);
                if (!opVal->IsString()) {
                    Nan::ThrowError("Job.add redirect op needs to be a string");
                    return;
                }
                auto fileVal = redirObj->Get(fileKey);
                if (!fileVal->IsString()) {
                    Nan::ThrowError("Job.add redirect file needs to be a string");
                    return;
                }
                int fromfd = 1, tofd = -1;
                bool append = false;
                std::string fname;
                const std::string op = *Nan::Utf8String(opVal);

                if (op == ">&") {
                    // file is a file descriptor
                    char* end = 0;
                    Nan::Utf8String utf8(fileVal);
                    tofd = strtol(*utf8, &end, 10);
                    if (tofd < 0 || !end || *end != '\0') {
                        // bad
                        Nan::ThrowError("Job.add redirect, file needs to be a positive number for >&");
                        return;
                    }
                } else {
                    // file is a file
                    if (op == ">>")
                        append = true;
                    fname = *Nan::Utf8String(fileVal);
                }

                if (redirObj->Has(ioKey)) {
                    auto ioVal = redirObj->Get(ioKey);
                    if (!ioVal->IsInt32()) {
                        Nan::ThrowError("Job.add redirect io needs to be an int");
                        return;
                    }
                    fromfd = v8::Local<v8::Int32>::Cast(ioVal)->Value();
                }
                Process::Redirect procRedir = { fromfd, tofd, fname, append };
                procRedirs.push_back(std::move(procRedir));
            }
            proc.setRedirects(std::move(procRedirs));
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

NAN_METHOD(Close) {
    auto job = Nan::ObjectWrap::Unwrap<NanJob>(info.Holder())->job;
    job->close();
}

NAN_METHOD(SetMode) {
    auto job = Nan::ObjectWrap::Unwrap<NanJob>(info.Holder())->job;
    if (!info.Length()) {
        Nan::ThrowError("Job.setMode takes a mode argument");
        return;
    }
    if (!info[0]->IsUint32()) {
        Nan::ThrowError("Job.setMode takes a mode (number) argument");
        return;
    }
    Job::Mode m;
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
    job->setMode(m, true);
}

NAN_METHOD(Command) {
    auto job = Nan::ObjectWrap::Unwrap<NanJob>(info.Holder())->job;
    const auto& cmd = job->command();
    if (!cmd.empty())
        info.GetReturnValue().Set(Nan::New(cmd.c_str()).ToLocalChecked());
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
            job->onStateChanged.push_back(std::make_shared<Nan::Callback>(v8::Local<v8::Function>::Cast(info[1])));
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
    NAN_EXPORT(target, users);

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
        Nan::SetPrototypeMethod(ctor, "close", job::Close);
        Nan::SetPrototypeMethod(ctor, "setMode", job::SetMode);
        Nan::SetPrototypeMethod(ctor, "command", job::Command);

        auto ctorFunc = Nan::GetFunction(ctor).ToLocalChecked();
        Nan::Set(ctorFunc, Nan::New("Foreground").ToLocalChecked(), Nan::New<v8::Uint32>(Job::Foreground));
        Nan::Set(ctorFunc, Nan::New("Background").ToLocalChecked(), Nan::New<v8::Uint32>(Job::Background));
        Nan::Set(ctorFunc, Nan::New("Stopped").ToLocalChecked(), Nan::New<v8::Uint32>(Job::Stopped));
        Nan::Set(ctorFunc, Nan::New("Terminated").ToLocalChecked(), Nan::New<v8::Uint32>(Job::Terminated));
        Nan::Set(ctorFunc, Nan::New("Failed").ToLocalChecked(), Nan::New<v8::Uint32>(Job::Failed));
        Nan::Set(ctorFunc, Nan::New("DupStdin").ToLocalChecked(), Nan::New<v8::Uint32>(Job::DupStdin));
        Nan::Set(ctorFunc, Nan::New("DupStdout").ToLocalChecked(), Nan::New<v8::Uint32>(Job::DupStdout));
        Nan::Set(ctorFunc, Nan::New("DupStderr").ToLocalChecked(), Nan::New<v8::Uint32>(Job::DupStderr));

        Nan::Set(target, cname, Nan::GetFunction(ctor).ToLocalChecked());
    }
}

NODE_MODULE(nativeJsh, Initialize)
