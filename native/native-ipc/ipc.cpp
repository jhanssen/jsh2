#include <nan.h>
#include <functional>
#include <memory>
#include <unordered_map>
#include <vector>
#include <string>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <sys/types.h>
#include <sys/socket.h>
#include <sys/select.h>
#include <sys/un.h>
#include <sys/stat.h>
#include <arpa/inet.h>
#include "utils.h"

//#define LOG

#ifdef LOG
static void log(const char* fmt, ...)
{
    static uint32_t pid = getpid();
    char fn[128];
    snprintf(fn, sizeof(fn), "/tmp/native-ipc-%u.log", pid);

    FILE* f = fopen(fn, "a");
    if (!f)
        return;
    va_list ap;
    va_start(ap, fmt);
    vfprintf(f, fmt, ap);
    va_end(ap);
    fclose(f);
}
#else
#define log(...)
#endif

struct State {
    State()
        : stopped(false), disconnected(false), newClients(0), disconnectedClients(0)
    {
        wakeupPipe[0] = wakeupPipe[1] = -1;
    }

    struct FD {
        enum Type {
            Server,
            Client
        };
        Type type;
        int fd;
    };
    std::vector<FD> fds;
    int wakeupPipe[2];
    uv_thread_t thread;
    uv_async_t async;

    bool init(FD::Type, int fd);

    static void run(void* arg);

    Mutex mutex;
    bool stopped, disconnected;
    int newClients, disconnectedClients;
    std::vector<std::string> parsedDatas;

    void stop();
    void cleanup();
    void wakeup();
    void write(const std::string& data);

    std::unordered_map<std::string, std::vector<std::shared_ptr<Nan::Callback> > > ons;

private:
    enum HandleState {
        Failure,
        Disconnected,
        Success
    };
    HandleState handleData(int fd);
    void parseData(std::string& data);
    void run();

    void runOn(const std::string& name, const std::string& data = std::string());

    std::unordered_map<int, std::string> readdata;
    std::unordered_map<int, std::vector<std::string> > writedata;

} state;

bool State::init(FD::Type type, int fd)
{
    bool empty;
    {
        MutexLocker locker(&mutex);
        empty = state.fds.empty();
        state.fds.push_back({ type, fd });
        if (!empty) {
            wakeup();
            return empty;
        }
    }

    ::pipe(wakeupPipe);

    int r = fcntl(wakeupPipe[0], F_GETFL);
    fcntl(wakeupPipe[0], F_SETFL, r | O_NONBLOCK | O_CLOEXEC);
    r = fcntl(wakeupPipe[1], F_GETFL);
    fcntl(wakeupPipe[1], F_SETFL, r | O_CLOEXEC);

    uv_async_init(uv_default_loop(), &async, [](uv_async_t*) {
            std::vector<std::string> parsed;
            bool disconnected = false;
            {
                MutexLocker locker(&state.mutex);
                parsed = std::move(state.parsedDatas);
                disconnected = state.disconnected;
            }
            for (const auto& p : parsed) {
                state.runOn("data", p);
            }
            if (disconnected) {
                uv_thread_join(&state.thread);
                state.cleanup();
                state.runOn("disconnected");
            }
            while (state.newClients > 0) {
                --state.newClients;
                state.runOn("newClient");
            }
            while (state.disconnectedClients > 0) {
                --state.disconnectedClients;
                state.runOn("disconnectedClient");
            }
        });
    return empty;
}

void State::runOn(const std::string& name, const std::string& data)
{
    Nan::HandleScope scope;
    v8::Local<v8::Value> ret;
    if (data.empty()) {
        ret = Nan::Undefined();
    } else {
        ret = v8::Local<v8::Value>::Cast(Nan::New(data.c_str()).ToLocalChecked());
    }

    const auto& o = state.ons[name];
    for (const auto& cb : o) {
        if (!cb->IsEmpty()) {
            cb->Call(1, &ret);
        }
    }
}

void State::run(void* arg)
{
    state.run();
}

void State::run()
{
    log("State::run\n");
    auto checkStop = [this]() {
        MutexLocker locker(&mutex);
        if (stopped) {
            bool reallystop = true;
            // only stop if we've written absolutely everything
            for (const auto wr : writedata) {
                if (!wr.second.empty()) {
                    reallystop = false;
                    break;
                }
            }
            return reallystop;
        }
        return false;
    };
    fd_set rdset, wrset;
    fd_set* wrsetptr;
    for (;;) {
        log("State::run, start loop\n");
        int max = wakeupPipe[0];
        FD_ZERO(&rdset);
        FD_ZERO(&wrset);
        wrsetptr = 0;
        FD_SET(wakeupPipe[0], &rdset);
        {
            log("State::run, write start\n");

            MutexLocker locker(&mutex);
            auto it = fds.begin();
            while (it != fds.cend()) {
                log("State::run, start write loop\n");

                auto fd = *it;
                FD_SET(fd.fd, &rdset);
                if (fd.fd > max) {
                    max = fd.fd;
                }
                if (fd.type == FD::Client) {
                    log("State::run, write got client\n");
                    auto& wr = writedata[fd.fd];
                    if (wr.empty()) {
                        ++it;
                        continue;
                    }
                    log("State::run, write got some data maybe\n");
                    // try to write
                    bool out = false;
                    int e;
                    auto sit = wr.begin();
                    while (sit != wr.cend()) {
                        auto& str = *sit;
                        for (;;) {
                            log("State::run, write inner loop\n");
                            if (str.empty()) {
                                log("State::run, write erasing\n");
                                sit = wr.erase(sit);
                                log("State::run, write erased\n");
                                break;
                            }
                            log("State::run, write performing write %zu\n", str.size());
                            EINTRWRAP(e, ::write(fd.fd, &str[0], str.size()));
                            if (e > 0) {
                                log("State::run, write substring %d\n", e);
                                str = str.substr(e);
                                continue;
                            } else if (e < 0) {
                                log("State::run, write got error\n");
                                if (errno == EAGAIN || errno == EWOULDBLOCK) {
                                    log("State::run, write got eagain\n");
                                    // go to the next one
                                    if (!wrsetptr)
                                        wrsetptr = &wrset;
                                    FD_SET(fd.fd, &wrset);
                                    out = true;
                                    break;
                                }
                                log("State::run, write got some bad error %d\n", errno);
                                // badness, take our fd out. if this is our only fd then we're in trouble
                                it = fds.erase(it);
                                if (fds.empty()) {
                                    log("State::run, write out of fds, telling main thread\n");
                                    MutexLocker locker(&mutex);
                                    disconnected = true;
                                    uv_async_send(&async);
                                    return;
                                }
                                log("State::run, write we're out\n");
                                out = true;
                                break;
                            }
                        }
                        if (out)
                            break;
                    }
                }
                ++it;
            }
        }
        if (checkStop()) {
            log("State::run, got stop 1\n");
            break;
        }
        log("State::run, selecting %d\n", max);
        int r = ::select(max + 1, &rdset, wrsetptr, 0, 0);
        log("State::run, selected %d\n", r);
        if (r > 0) {
            if (FD_ISSET(wakeupPipe[0], &rdset)) {
                log("State::run, got pipe data\n");
                // drain pipe
                char c;
                int e;
                for (;;) {
                    EINTRWRAP(e, ::read(wakeupPipe[0], &c, 1));
                    if (e != 1)
                        break;
                }

            }
            std::vector<FD> localFds;
            {
                MutexLocker locker(&mutex);
                localFds = fds;
            }
            for (auto fd : localFds) {
                log("State::run, got checking fd %d\n", fd.fd);
                if (FD_ISSET(fd.fd, &rdset)) {
                    log("State::run, data on fd %d (type %d)\n", fd.fd, fd.type);
                    switch (fd.type) {
                    case FD::Client:
                        // got data
                        log("State::run, handle read\n");
                        switch (handleData(fd.fd)) {
                        case Failure: {
                            log("State::run, handle read failed\n");
                            // badness
                            MutexLocker locker(&mutex);
                            disconnected = true;
                            uv_async_send(&async);
                            return; }
                        case Disconnected: {
                            log("State::run, handle read disconnected\n");
                            // take this dude out of our set. if it's our last one then we're out
                            MutexLocker locker(&mutex);
                            auto fit = fds.begin();
                            const auto fend = fds.cend();
                            while (fit != fend) {
                                if (fit->fd == fd.fd) {
                                    log("State::run, handle read removed\n");
                                    ++disconnectedClients;

                                    fds.erase(fit);
                                    if (fds.size() <= 1) {
                                        log("State::run, handle read, we're gone\n");
                                        disconnected = true;
                                        uv_async_send(&async);
                                        return;
                                    }
                                    uv_async_send(&async);
                                    break;
                                }
                                ++fit;
                            }
                            break; }
                        case Success:
                            break;
                        }
                        log("State::run, handled read\n");
                        break;
                    case FD::Server: {
                        log("State::run, accepting\n");
                        int cl;
                        EINTRWRAP(cl, accept(fd.fd, NULL, NULL));
                        if (cl == -1) {
                            log("State::run, failed to accept\n");
                            // badness
                            MutexLocker locker(&mutex);
                            disconnected = true;
                            uv_async_send(&async);
                            return;
                        } else {
                            log("State::run, got new fd %d\n", cl);
                            int r = fcntl(cl, F_GETFL);
                            fcntl(cl, F_SETFL, r | O_NONBLOCK | O_CLOEXEC);

                            // push new client
                            MutexLocker locker(&mutex);
                            fds.push_back({ FD::Client, cl });
                            ++newClients;
                            uv_async_send(&async);
                        }
                        break; }
                    }
                }
            }
        }
        if (checkStop()) {
            log("State::run, got stop 2\n");
            break;
        }
    }
}

State::HandleState State::handleData(int fd)
{
    char buf[16384];
    int rd;
    EINTRWRAP(rd, ::read(fd, buf, sizeof(buf)));
    if (rd == -1 && (errno == EAGAIN || errno == EWOULDBLOCK))
        return Success;
    if (!rd)
        return Disconnected;
    if (rd < 0)
        return Failure;
    std::string& local = readdata[fd];
    local += std::string(buf, rd);
    parseData(local);
    return Success;
}

void State::parseData(std::string& local)
{
    if (local.size() < 4)
        return;
    // first 4 bytes is the number of bytes in the message
    uint32_t* ptr = reinterpret_cast<uint32_t*>(&local[0]);
    uint32_t num = ntohl(*ptr);
    if (local.size() - 4 < num)
        return;
    std::string parse = local.substr(4, num);
    local = local.substr(num + 4);

    MutexLocker locker(&mutex);
    parsedDatas.push_back(parse);
    uv_async_send(&async);
}

void State::stop()
{
    MutexLocker locker(&mutex);
    stopped = true;
    wakeup();
}

void State::cleanup()
{
    int e;

    for (auto fd : state.fds) {
        EINTRWRAP(e, ::close(fd.fd));
    }
    state.fds.clear();

    EINTRWRAP(e, ::close(state.wakeupPipe[0]));
    state.wakeupPipe[0] = -1;

    EINTRWRAP(e, ::close(state.wakeupPipe[1]));
    state.wakeupPipe[1] = -1;
}

void State::wakeup()
{
    int e;
    char c = 'w';
    EINTRWRAP(e, ::write(wakeupPipe[1], &c, 1));
}

void State::write(const std::string& data)
{
    MutexLocker locker(&mutex);
    for (auto fd : fds) {
        if (fd.type == FD::Client) {
            union {
                uint32_t sz;
                char buf[4];
            } len;
            len.sz = htonl(data.size());
            std::string ndata = std::string(len.buf, 4) + data;
            writedata[fd.fd].push_back(ndata);
        }
    }
    wakeup();
}

NAN_METHOD(connect) {
    // arguments: path, callback
    // if (info.Length() > 1 && info[0]->IsString() && info[1]->IsFunction()) {
    if (info.Length() > 0 && info[0]->IsString()) {
        const std::string path = *Nan::Utf8String(info[0]);
        // connect to path.

        int fd = socket(AF_UNIX, SOCK_STREAM, 0);
        if (fd == -1) {
            Nan::ThrowError("Can't make IPC socket");
            return;
        }
        int r = fcntl(fd, F_GETFL);
        fcntl(fd, F_SETFL, r | O_NONBLOCK | O_CLOEXEC);

        int e;
        struct sockaddr_un addr;
        memset(&addr, 0, sizeof(addr));
        addr.sun_family = AF_UNIX;
        strncpy(addr.sun_path, path.c_str(), sizeof(addr.sun_path)-1);
        EINTRWRAP(e, connect(fd, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)));
        if (e == -1) {
            // failure to connect, return status
            EINTRWRAP(e, ::close(fd));
            info.GetReturnValue().Set(Nan::New<v8::Boolean>(false));
        } else {
            // we're good, launch thread and return status
            if (state.init(State::FD::Client, fd))
                uv_thread_create(&state.thread, State::run, 0);
            info.GetReturnValue().Set(Nan::New<v8::Boolean>(true));
        }
    } else {
        info.GetReturnValue().Set(Nan::New<v8::Boolean>(false));
    }
}

NAN_METHOD(on) {
    if (info.Length() > 1 && info[0]->IsString() && info[1]->IsFunction()) {
        const std::string name = *Nan::Utf8String(info[0]);
        state.ons[name].push_back(std::make_shared<Nan::Callback>(v8::Local<v8::Function>::Cast(info[1])));
    }
}

NAN_METHOD(write) {
    if (info.Length() > 0 && info[0]->IsString()) {
        const std::string data = *Nan::Utf8String(info[0]);
        state.write(data);
    }
}

NAN_METHOD(listen) {
    if (info.Length() > 0 && info[0]->IsString()) {
        const std::string path = *Nan::Utf8String(info[0]);
        // connect to path.

        int fd = socket(AF_UNIX, SOCK_STREAM, 0);
        if (fd == -1) {
            Nan::ThrowError("Can't make IPC socket");
            return;
        }

        // remote the path if it's a socket file. is this safe?
        struct stat st;
        int e = ::stat(path.c_str(), &st);
        if (!e) {
            if ((st.st_mode & S_IFMT) == S_IFSOCK) {
                unlink(path.c_str());
            }
        }

        struct sockaddr_un addr;
        memset(&addr, 0, sizeof(addr));
        addr.sun_family = AF_UNIX;
        strncpy(addr.sun_path, path.c_str(), sizeof(addr.sun_path)-1);
        if (bind(fd, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)) == -1) {
            info.GetReturnValue().Set(Nan::New<v8::Boolean>(false));
        } else {
            if (listen(fd, 5) == -1) {
                info.GetReturnValue().Set(Nan::New<v8::Boolean>(false));
            } else {
                if (state.init(State::FD::Server, fd))
                    uv_thread_create(&state.thread, State::run, 0);
                info.GetReturnValue().Set(Nan::New<v8::Boolean>(true));
            }
        }
    } else {
        info.GetReturnValue().Set(Nan::New<v8::Boolean>(false));
    }
}

NAN_METHOD(connected) {
    info.GetReturnValue().Set(Nan::New<v8::Boolean>(state.wakeupPipe[0] != -1));
}

NAN_METHOD(stop) {
    if (state.wakeupPipe[0] != -1) {
        state.stop();
        uv_thread_join(&state.thread);
        state.cleanup();
    }
}

NAN_MODULE_INIT(Initialize) {
    NAN_EXPORT(target, connect);
    NAN_EXPORT(target, connected);
    NAN_EXPORT(target, write);
    NAN_EXPORT(target, stop);
    NAN_EXPORT(target, on);

    NAN_EXPORT(target, listen);
}

NODE_MODULE(nativeIpc, Initialize)