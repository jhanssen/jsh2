/*global module,require,setInterval,clearInterval*/

const nativeIpc = require("native-ipc");
const homedir = require("homedir");
const path = require("path");
const EventEmitter = require("events");
const childProcess = require("child_process");

class Ipc extends EventEmitter {
    constructor() {
        super();
    }

    start() {
        this.path = path.join(homedir(), ".jsh.socket");
        return new Promise((resolve, reject) => {
            console.log("ipc pre connect");
            if (nativeIpc.connect(this.path)) {
                console.log("ipc connected 1");
                this._setup();
                resolve();
            } else {
                console.log("ipc pre launch");
                if (!this._launch()) {
                    reject("couldn't launch ipc daemon");
                    return;
                }
                let start = Date.now();
                let iv = setInterval(() => {
                    console.log("ipc connect trying");
                    if (Date.now() - start > this.MaxTimeout) {
                        console.log("ipc connect timeout");
                        clearInterval(iv);
                        reject("timeout");
                    }
                    if (nativeIpc.connect(this.path)) {
                        console.log("ipc connected 2");
                        clearInterval(iv);
                        this._setup();
                        resolve();
                    }
                }, 500);
            }
        });
    }

    connection() {
        return new Promise((resolve, reject) => {
            if (nativeIpc.connected()) {
                console.log("connection connected");
                resolve();
            } else {
                console.log("connection start?");
                resolve(this.start());
            }
        });
    }

    write(data) {
        if (typeof data == "string") {
            nativeIpc.write(data);
        } else {
            let d;
            try {
                d = JSON.stringify(data);
                nativeIpc.write(d);
            } catch (e) {
            }
        }
    }

    load(p) {
        this.connection().then(() => {
            this.write({ cmd: "eval", data: p });
        }).catch((e) => {
            console.error(e);
        });
    }

    _launch() {
        childProcess.fork("./lib/ipc/server");
        return true;
    }

    _setup() {
        nativeIpc.on("disconnected", () => {
            console.log("disconnected?");
            this._disconnected();
        });
        nativeIpc.on("data", (datastr) => {
            try {
                let data = JSON.parse(datastr);
                this.emit("data", data);
            } catch (e) {
            }
        });
    }

    _disconnected() {
        return this.start();
    }
};

module.exports = new Ipc();
