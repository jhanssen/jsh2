/*global require,process*/

const daemonize = require("daemon");
const nativeIpc = require("native-ipc");
const homedir = require("homedir");
const path = require("path");
const util = require("util");
const fs = require("fs");

console.log = function(...args) {
    const str = util.format(...args);
    fs.appendFileSync("/tmp/jsh-server.log", str + "\n");
};

console.error = function(...args) {
    const str = util.format(...args);
    fs.appendFileSync("/tmp/jsh-server.log", str + "\n");
};

const wrapper = {
    on: function(type, cb) {
        if (type == "data") {
            // let's parse the data for the module
            let parsedCb = (id, data) => {
                // console.log("got", data);
                try {
                    let parsed = JSON.parse(data);
                    cb(parsed);
                } catch (e) {
                }
            };
            nativeIpc.on(type, parsedCb);
        } else {
            let wrapCb = (id, data) => {
                cb(data);
            };
            nativeIpc.on(type, wrapCb);
        }
    },
    write: function(data) {
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
};

const state = {
    requires: {},
    clients: new Set(),
    add: function(path, cfg) {
        if (path in state.requires)
            return;
        state.requires[path] = require(path)(wrapper, cfg || {});
    }
};

const handlers = {
    eval: (id, data, cfg) => {
        // console.log("evaling", data);
        try {
            state.add(data, cfg);
        } catch (e) {
        }
    },
    send: (id, data, cfg) => {
        // send data to everyone but myself
        let to = [];
        for (let sid of state.clients) {
            if (sid != id)
                to.push(sid);
        }
        if (!to.length)
            return;
        let send = { data: data, cfg: cfg };
        try {
            let d = JSON.stringify(send);
            process.nextTick(() => {
                nativeIpc.write(d, to);
            });
        } catch (e) {
        }
    }
};

function handle(id, data)
{
    if (data.cmd in handlers) {
        handlers[data.cmd](id, data.data, data.cfg);
    }
}

function server()
{
    const p = path.join(homedir(), ".jsh.socket");
    if (!nativeIpc.listen(p))
        process.exit();
    nativeIpc.on("newClient", (id) => {
        state.clients.add(id);
    });
    nativeIpc.on("disconnectedClient", (id) => {
        state.clients.delete(id);
    });
    nativeIpc.on("disconnected", () => {
        // console.log("got disconnected");
        process.exit();
    });
    nativeIpc.on("data", (id, datastr) => {
        // console.log("got data", datastr);
        try {
            let data = JSON.parse(datastr);
            handle(id, data);
        } catch (e) {
            console.log("didn't parse as json", e);
        }
    });
}

try {
    daemonize();
    server();
} catch (e) {
    // console.log("out", e);
}
