/*global require,module,process*/

const EventEmitter = require("events");

const native = require("native-jsh");
const Job = native.Job;

const isGenerator = function isGenerator(fun) {
    if (!fun)
        return false;
    return /^function\s*\*/.test(fun.toString());
};

function merge(obj1, obj2)
{
    const obj = {};
    var k;
    for (k in obj1) {
        obj[k] = obj1[k];
    }
    for (k in obj2) {
        obj[k] = obj2[k];
    }
    return obj;
}

class Stdout extends EventEmitter {
    constructor() {
        super();
        this.buffer = [];
        this.closed = false;

        this.on("newListener", (event, listener) => {
            switch (event) {
            case "data":
                if (this.buffer.length > 0) {
                    process.nextTick(() => {
                        for (let i = 0; i < this.buffer.length; ++i) {
                            listener(this.buffer[i]);
                        }
                        this.buffer = [];
                    });
                }
                break;
            case "closed":
                if (this.closed) {
                    process.nextTick(() => {
                        listener();
                    });
                }
                break;
            }
        });
    }

    writer() {
        return (w) => {
            if (this.closed)
                return;
            if (this.listenerCount("data") > 0) {
                this.emit("data", w);
            } else {
                this.buffer.push(w);
            }
        };
    }

    close() {
        this.emit("closed");
        this.closed = true;
    }
};

class ScriptJob extends EventEmitter {
    constructor(jsh) {
        super();
        this.shell = jsh.shell;
        this.commands = [];
        this.finalizers = [];
        this.stdout = new Stdout();
        this.stdin = this.stdout.writer();

        this._state = undefined;
        this._status = undefined;

        this.on("newListener", (event, listener) => {
            if (event == "stateChanged") {
                if (this._state !== undefined) {
                    process.nextTick(() => {
                        listener(this._state, this._status);
                    });
                }
            }
        });
    }

    add(cmd) {
        this.commands.push(cmd);
        this.finalizers = this.finalizers.concat(cmd.script.finalizers || []);
    }

    write(data) {
        this.stdin(data);
    }

    close() {
        this.stdout.close();
    }

    start(flags, dupflags) {
        if (typeof dupflags !== "number")
            dupflags = 0;
        if (flags & Job.Background) {
            if (this.listenerCount("stdout") > 0)
                dupflags |= Job.DupStdout;
            if (this.listenerCount("stderr") > 0)
                dupflags |= Job.DupStderr;
        }

        let stdin = this.stdout;
        let stdout = undefined;
        let stderr = undefined;
        let lastout = undefined;

        if (dupflags & Job.DupStderr) {
            stderr = (w) => { this.emit("stderr", w); };
        } else {
            stderr = (w) => { console.error(w); };
        }
        if (dupflags & Job.DupStdout) {
            lastout = {
                writer: () => { return (w) => { this.emit("stdout", w); }; }
            };
        } else {
            lastout = {
                writer: () => { return (w) => { console.log(w); }; }
            };
        }

        for (let i = 0; i < this.commands.length; ++i) {
            let command = this.commands[i].command;
            let script = this.commands[i].script;
            let first = i == 0;
            let last = i == this.commands.length - 1;
            if (last) {
                stdout = lastout;
            } else {
                stdout = new Stdout();
            }

            if (isGenerator(script.cmd)) {
                // do stuff
                throw "No support for running generator functions yet";
            } else {
                // normal function
                let outwriter = stdout.writer();

                let jsh = {
                    io: {
                        stdout: outwriter,
                        stderr: stderr,
                        stdin: stdin
                    },
                    shell: this.shell,
                    env: merge(this.shell.env, command.assigns)
                };
                let ret;
                if (script.cmd instanceof Function) {
                    if (command.args === undefined) {
                        ret = script.cmd(jsh);
                    } else if (command.args instanceof Array) {
                        ret = script.cmd(jsh, ...command.args);
                    } else {
                        ret = script.cmd(jsh, command.args);
                    }
                }

                let notify = (status) => {
                    let reallyNotify = () => {
                        if (last) {
                            if (dupflags & Job.DupStdout) {
                                this.emit("stdout", "\n");
                            }
                            this._changeState(Job.Terminated, status);

                            if (this.finalizers.length > 0) {
                                process.nextTick(() => {
                                    // run finalizers
                                    for (let idx = 0; idx < this.finalizers.length; ++idx) {
                                        if (command.args === undefined) {
                                            this.finalizers[idx](jsh);
                                        } else if (command.args instanceof Array) {
                                            this.finalizers[idx](jsh, ...command.args);
                                        } else {
                                            this.finalizers[idx](jsh, command.args);
                                        }
                                    }
                                });
                            }
                        } else {
                            stdout.close();
                        }
                    };
                    if (first && last) {
                        reallyNotify();
                    } else {
                        process.nextTick(reallyNotify);
                    }
                };

                let done = (ret, write) => {
                    switch (typeof ret) {
                    case "number":
                        notify(ret);
                        break;
                    case "object":
                        write(JSON.stringify(ret));
                        if ("status" in ret) {
                            notify(ret.status);
                        } else {
                            notify(0);
                        }
                        break;
                    case "string":
                        write(ret);
                        notify(0);
                        break;
                    default:
                        notify(0);
                        break;
                    }
                };

                if (ret instanceof Promise) {
                    ret.then((ret) => { done(ret, outwriter); }).catch((err) => { done(err, stderr); });
                } else {
                    done(ret, outwriter);
                }

                stdin = stdout;
            }
        }
    }

    _changeState(state, status) {
        this.emit("stateChanged", state, status);
        this._state = state;
        this._status = status;
    }
};

module.exports = ScriptJob;
