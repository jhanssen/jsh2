#include <nan.h>

NAN_METHOD(init) {
}

NAN_METHOD(deinit) {
}

NAN_MODULE_INIT(Initialize) {
    NAN_EXPORT(target, init);
    NAN_EXPORT(target, deinit);
}

NODE_MODULE(nativeJsh, Initialize)
