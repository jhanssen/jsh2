/*global require,module,process*/
const binarysearch = require("binarysearch");
const fs = require("fs");
const path = require("path");
const commands = require("./commands");

class Completion
{
    constructor(name, ...args) {
        this._name = name;
        this._match = undefined;
        this._completions = undefined;
        let idx = 0;
        while (args.length > idx) {
            if (this._match === undefined) {
                if (args[idx] instanceof RegExp || typeof args[idx] === "string") {
                    this._match = args[idx];
                    ++idx;
                    continue;
                }
            }
            if (this._completions === undefined) {
                if (args[idx] instanceof Array) {
                    this._completions = args[idx];
                } else {
                    this._completions = [args[idx]];
                }
                break;
            }
        }
        if (this._name === undefined || this._completions === undefined) {
            throw "Invalid completion";
        }
        if (this._match === undefined)
            this._match = this._name;
    }

    match(cmd, data) {
        return this._internalMatch(cmd, data, 0, this);
    }

    _internalMatch(cmd, data, pos, cmp) {
        let find = (pos, cmp) => {
            // traverse this._completions
            let ret;
            if (pos === cmd.length - 1) {
                // final item
                ret = [];
                for (let k = 0; k < cmp.length; ++k) {
                    let name;
                    if (cmd[k] instanceof Completion)
                        name = cmd[k]._name;
                    else
                        name = cmd[k] + "";
                    if (name.substr(0, data.end - data.start) == data.buffer)
                        ret.push(name);
                }
                return ret;
            }
            // find the first sub that matches
            for (let k = 0; k < cmp.length; ++k) {
                if (cmp[k] instanceof Completion) {
                    if ((ret = this._internalMatch(cmd, data, pos + 1, cmp[k])))
                        return ret;
                }
            }
            return undefined;
        };

        if (!cmd.length)
            return undefined;
        if (cmp._match instanceof RegExp) {
            if (cmp._match.test(cmd[pos])) {
                return find(pos, cmp._completions);
            }
        } else if (typeof cmp._match === "string" && cmd[pos] == cmp._match) {
            return find(cmd, data, pos, cmp._completions);
        }
        return undefined;
    }
}

class Cache {
    constructor(cmp) {
        this._items = [];
        this._cmp = cmp;
    }

    add(item) {
        let pos = binarysearch.closest(this._items, item, this._cmp);
        if (pos < this._items.length && this._items[pos] == item)
            return;
        this._items.splice(pos, 0, item);
    }

    remove(item) {
        let pos = binarysearch(this._items, item, this._cmp);
        if (pos == -1)
            return;
        this._items.splice(pos, 1);
    }

    get items() { return this._items; }
}

// taken from https://github.com/kevva/executable, MIT licensed
const isExe = (mode, gid, uid) => {
    const isGroup = gid ? process.getgid && gid === process.getgid() : true;
    const isUser = uid ? process.getuid && uid === process.getuid() : true;

    return Boolean((mode & parseInt('0001', 8)) ||
                   ((mode & parseInt('0010', 8)) && isGroup) ||
                   ((mode & parseInt('0100', 8)) && isUser));
};

const pwdCmp = (val, find) => {
    // apparently MUCH faster than localeCompare(), http://jsperf.com/localecompare
    return val.fn < find.fn ? -1 : val.fn > find.fn ? 1 : 0;
};

const state = {
    completions: [],

    pwdcache: new Cache(pwdCmp),
    execache: new Cache(),

    updatePwd: function updatePwd(pwd) {
        fs.readdir(pwd, (err, files) => {
            if (err)
                return;
            for (let idx = 0; idx < files.length; ++idx) {
                let fn = path.join(pwd, files[idx]);
                fs.stat(fn, (err, stats) => {
                    if (err)
                        return;
                    state.pwdcache.add({ fn: fn, stats: stats });
                });
            }
        });
    },

    updateExe: function updateExe(exe) {
        fs.readdir(exe, (err, files) => {
            // check if file is executable
            if (err)
                return;
            for (let idx = 0; idx < files.length; ++idx) {
                let fn = files[idx];
                fs.stat(path.join(exe, fn), (err, stats) => {
                    if (err)
                        return;
                    if (stats.isFile() && isExe(stats.mode, stats.gid, stats.uid)) {
                        // console.log(`updating ${fn}`);
                        state.execache.add(fn);
                    }
                });
            }
        });
    }
};

function tokenize(buffer)
{
    let State = { Normal: 0, Escaped: 1, SingleQuote: 2, DoubleQuote: 3 };
    let state = [State.Normal];
    let lastState = () => {
        return state[state.length - 1];
    };

    let out = [];
    let cur = "";
    for (var i = 0; i < buffer.length; ++i) {
        switch (buffer[i]) {
        case '\\':
            if (lastState() == State.Normal) {
                state.push(State.Escaped);
                // don't reescape quotes
                if (i + 1 < buffer.length) {
                    switch (buffer[i + 1]) {
                    case '"':
                    case '\'':
                    case ' ':
                        break;
                    default:
                        cur += '\\';
                        break;
                    }
                } else {
                    cur += '\\';
                }
            } else if (lastState() == State.Escaped) {
                state.pop();
                cur += '\\';
            }
            break;
        case '"':
            if (lastState() == State.Normal) {
                state.push(State.DoubleQuote);
            } else if (lastState() == State.DoubleQuote) {
                state.pop();
            } else if (lastState() == State.Escaped) {
                state.pop();
                cur += '"';
            }
            break;
        case '\'':
            if (lastState() == State.Normal) {
                state.push(State.SingleQuote);
            } else if (lastState() == State.SingleQuote) {
                state.pop();
            } else if (lastState() == State.Escaped) {
                state.pop();
                cur += '\'';
            }
            break;
        case ' ':
            if (lastState() == State.Normal) {
                if (cur.length > 0) {
                    out.push(cur);
                    cur = "";
                }
            } else {
                cur += ' ';
            }
            break;
        default:
            cur += buffer[i];
            break;
        }
    }
    if (lastState() == State.Normal) {
        // we'll want to push an empty item here if our last character was a string
        out.push(cur);
    }
    return out;
}

const completions = {
    Completion: Completion,

    register: function register(completion) {
        state.completions.push(completion);
    },

    PWD: 0,
    PATH: 1,

    update: function update(type, arg) {
        if (type === completions.PWD) {
            // update state.pwdcache
            state.pwdcache = new Cache(pwdCmp);
            state.updatePwd(arg);
        } else if (type === completions.PATH) {
            // update state.execache
            state.execache = new Cache();
            // insert jsh commands
            let idx;
            let cmds = commands.names;
            for (idx = 0; idx < cmds.length; ++idx) {
                state.execache.add(cmds[idx]);
            }
            // insert executable files in PATH
            let dirs = arg.split(':');
            for (idx = 0; idx < dirs.length; ++idx) {
                state.updateExe(dirs[idx]);
            }
        }
    },

    complete: function complete(data, cb) {
        let ret;
        if (data.start === 0) {
            // complete on commands and executable files
            ret = [];
            let execache = state.execache.items;
            for (let k = 0; k < execache.length; ++k) {
                if (execache[k].substr(0, data.end) == data.buffer)
                    ret.push(execache[k]);
            }
            //console.log("would send 1", ret);
            cb(ret);
            return;
        }

        for (let i = 0; i < state.completions; ++i) {
            let split = tokenize(data.buffer);
            if ((ret = state.completions[i].match(split, data))) {
                console.log("would send 2", ret);
                cb();
                return;
            }
        }
        console.log("complete", JSON.stringify(data, null, 4));
        cb();
    }
};

module.exports = completions;
