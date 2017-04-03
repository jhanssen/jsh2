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
            let parsedCb = (data) => {
                try {
                    let parsed = JSON.parse(data);
                    cb(parsed);
                } catch (e) {
                }
            };
            nativeIpc.on(type, parsedCb);
        } else {
            nativeIpc.on(type, cb);
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
    add: function(path, cfg) {
        if (path in state.requires)
            return;
        state.requires[path] = require(path)(wrapper, cfg || {});
    }
};

const handlers = {
    eval: (data, cfg) => {
        //console.log("evaling", data);
        try {
            state.add(data, cfg);
        } catch (e) {
        }
    }
};

function handle(data)
{
    // console.log("handling", data);
    if (data.cmd in handlers) {
        handlers[data.cmd](data.data, data.cfg);
    }
}

function server()
{
    const p = path.join(homedir(), ".jsh.socket");
    if (!nativeIpc.listen(p))
        process.exit();
    nativeIpc.on("disconnected", () => {
        // console.log("got disconnected");
        process.exit();
    });
    nativeIpc.on("data", (datastr) => {
        // console.log("got data", datastr);
        try {
            let data = JSON.parse(datastr);
            handle(data);
        } catch (e) {
            console.log("didn't parse as json", e);
        }
    });
}

try {
    daemonize();
    server();
} catch (e) {
    console.log("out", e);
}
