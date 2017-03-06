/*global require,module,process*/

"use strict";

const binarysearch = require("binarysearch");
const fs = require("fs");
const path = require("path");
const commands = require("../commands");
const bashTokenizer = require("bash-parser/src/modes/posix/tokenizer");

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
const isExe = (stats) => {
    const isGroup = stats.gid ? process.getgid && stats.gid === process.getgid() : true;
    const isUser = stats.uid ? process.getuid && stats.uid === process.getuid() : true;

    return Boolean((stats.mode & parseInt('0001', 8)) ||
                   ((stats.mode & parseInt('0010', 8)) && isGroup) ||
                   ((stats.mode & parseInt('0100', 8)) && isUser));
};

const pwdCmp = (val, find) => {
    // apparently MUCH faster than localeCompare(), http://jsperf.com/localecompare
    return val.fn < find.fn ? -1 : val.fn > find.fn ? 1 : 0;
};

const state = {
    completions: [],

    pwdcache: new Cache(pwdCmp),
    execache: new Cache(),
    dircache: new Map(),

    updatePwd: function updatePwd(pwd, cb) {
        fs.readdir(pwd, (err, files) => {
            if (err) {
                cb();
                return;
            }
            let rem = files.length;
            let newcache = new Cache(pwdCmp);
            let dec = () => {
                if (!--rem)
                    cb(newcache);
            };
            for (let idx = 0; idx < files.length; ++idx) {
                let fn = path.join(pwd, files[idx]);
                fs.stat(fn, (err, stats) => {
                    if (err) {
                        dec();
                        return;
                    }
                    newcache.add({ fn: fn, stats: stats });
                    dec();
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
                    if (stats.isFile() && isExe(stats)) {
                        // console.log(`updating ${fn}`);
                        state.execache.add(fn);
                    }
                });
            }
        });
    },

    dirComplete: function dirComplete(data, tokens, cb, cmp) {
        if (!data.buffer.length) {
            cb();
            return;
        }

        const filter = (key, files) => {
            let ret = [];
            let dir = false;
            for (let idx = 0; idx < files.length; ++idx) {
                // console.log("filter", files[idx], files[idx].fn.substr(0, data.buffer.length), data.buffer);
                if (files[idx].fn.substr(0, key.length) == key) {
                    ret.push(files[idx].fn);
                    if (!dir && files[idx].dir)
                        dir = true;
                }
            };
            if (ret.length != 1)
                return ret;
            return { file: ret[0], dir: dir };
        };

        const reallyjoin = (...args) => {
            let ret = "";
            for (let idx = 0; idx < args.length; ++idx) {
                ret += args[idx];
                if (idx + 1 < args.length && ret.length > 0 && ret[ret.length - 1] != path.sep)
                    ret += path.sep;
            }
            return ret;
        };

        const complete = (key, data, tokens, cb) => {
            let obj;
            if ((obj = state.dircache.get(key))) {
                // console.log("got it");
                let ret = filter(tokens.tokens[0], obj);
                // console.log("aha", ret);
                if (ret instanceof Array) {
                    cb(ret);
                } else {
                    if (!ret.dir) {
                        cb([ret.file]);
                    } else {
                        // fake it
                        cb([reallyjoin(ret.file, "a"), reallyjoin(ret.file, "b")]);
                    }
                }
            } else {
                // readdir key
                fs.readdir(key, (err, files) => {
                    if (err) {
                        // welp, badness
                        state.dircache.set(key, undefined);
                        cb();
                    } else {
                        let ret = [];
                        let rem = files.length;
                        const done = () => {
                            if (!--rem) {
                                state.dircache.set(key, ret);
                                let newret = filter(tokens.tokens[0], ret);
                                if (newret instanceof Array) {
                                    cb(newret);
                                } else {
                                    if (!newret.dir) {
                                        cb([newret.file]);
                                    } else {
                                        cb([reallyjoin(newret.file, "a"), reallyjoin(newret.file, "b")]);
                                    }
                                }
                            }
                        };
                        for (let idx = 0; idx < files.length; ++idx) {
                            // path.join screws me over, join("./", "foo") becomes "foo"
                            let fn = reallyjoin(key, files[idx]);
                            fs.stat(fn, (err, stats) => {
                                if (err) {
                                    done();
                                    return;
                                }
                                if (cmp(stats)) {
                                    ret.push({ fn: fn, dir: stats.isDirectory() });
                                }
                                done();
                            });
                        }
                    }
                });
            }
        };

        // find the last '/', everything up until that is our path
        let str = tokens.tokens[0];
        let slash = str.lastIndexOf('/');
        if (slash == -1) {
            // we might still start with a '.'
            if (str[0] === '.') {
                complete("./", data, tokens, cb);
            } else {
                cb();
            }
            return;
        }
        complete(str.substr(0, slash + 1), data, tokens, cb);
    },

    expComplete: function expComplete(data, tok, cb) {
        cb();
    }
};

const TokenizeState = { Normal: 0, Escaped: 1, SingleQuote: 2, DoubleQuote: 3, Expansion: 4 };

// a bit sad I have to do this since I have an otherwise decent bash parser
function tokenize(buffer, start, end)
{
    let state = [TokenizeState.Normal];
    let lastState = () => {
        return state[state.length - 1];
    };

    let out = [];
    let cur = "";
    let beforeStart = 0;
    let beforeEnd = 0;
    let exp = [];
    let pendingExp = undefined;
    let pendingBrace = false;
    let finalizePendingExp = idx => {
        if (pendingExp === undefined)
            return false;

        let text = buffer.substr(pendingExp, idx - pendingExp);
        exp.push({ text: text, start: pendingExp, end: idx });
        pendingExp = undefined;
        pendingBrace = false;
        return true;
    };

    let befores = idx => {
        if (idx <= start)
            ++beforeStart;
        else if (idx <= end)
            ++beforeEnd;
    };

    for (var i = 0; i < buffer.length; ++i) {
        switch (buffer[i]) {
        case '\\':
            if (lastState() == TokenizeState.Normal) {
                if (!pendingBrace) {
                    if (finalizePendingExp(i))
                        state.pop();
                }

                state.push(TokenizeState.Escaped);
                befores(i);
                // don't reescape quotes
                // if (i + 1 < buffer.length) {
                //     switch (buffer[i + 1]) {
                //     case '"':
                //     case '\'':
                //     case ' ':
                //         befores(i);
                //         break;
                //     default:
                //         cur += '\\';
                //         break;
                //     }
                // } else {
                //     cur += '\\';
                // }
            } else if (lastState() == TokenizeState.Escaped) {
                state.pop();
                cur += '\\';
            }
            break;
        case '"':
            if (lastState() == TokenizeState.Normal) {
                befores(i);
                state.push(TokenizeState.DoubleQuote);
            } else if (lastState() == TokenizeState.DoubleQuote) {
                if (finalizePendingExp(i))
                    state.pop();

                befores(i);
                state.pop();
            } else if (lastState() == TokenizeState.Escaped) {
                state.pop();
                cur += '"';
            }
            break;
        case '\'':
            if (lastState() == TokenizeState.Normal) {
                befores(i);
                state.push(TokenizeState.SingleQuote);
            } else if (lastState() == TokenizeState.SingleQuote) {
                befores(i);
                state.pop();
            } else if (lastState() == TokenizeState.Escaped) {
                state.pop();
                cur += '\'';
            } else if (!pendingBrace) {
                if (finalizePendingExp(i))
                    state.pop();
            }
            break;
        case ' ':
            if (!pendingBrace) {
                if (finalizePendingExp(i))
                    state.pop();
                if (lastState() == TokenizeState.Normal) {
                    befores(i);
                    if (cur.length > 0) {
                        out.push(cur);
                        cur = "";
                    }
                } else {
                    cur += ' ';
                }
            } else {
                cur += ' ';
            }
            break;
        case '$':
            switch (lastState()) {
            case TokenizeState.Normal:
            case TokenizeState.DoubleQuote:
            case TokenizeState.Expansion:
                // expansion:
                if (!pendingBrace) {
                    finalizePendingExp(i);
                    pendingExp = i;
                    if (lastState() != TokenizeState.Expansion)
                        state.push(TokenizeState.Expansion);
                }
                break;
            default:
                break;
            }
            cur += buffer[i];
            break;
        case '{':
            if (pendingExp == i - 1) {
                // we're starting a brace expansion, continue until '}'
                pendingBrace = true;
            }
            cur += buffer[i];
            break;
        case '}':
            if (pendingBrace) {
                if (finalizePendingExp(i + 1))
                    state.pop();
            }
            cur += buffer[i];
            break;
        default:
            cur += buffer[i];
            break;
        }
    }

    finalizePendingExp(i);
    out.push(cur);

    return { tokens: out, state: lastState(), beforeStart: beforeStart, beforeEnd: beforeEnd, expansions: exp };
}

const completions = {
    Completion: Completion,

    register: function register(completion) {
        state.completions.push(completion);
    },

    PWD: 0,
    PATH: 1,
    DIR: 2,

    update: function update(type, arg) {
        if (type === completions.PWD) {
            // delete our dircache for .
            for (let k of state.dircache.keys()) {
                if (k[0] === '.')
                    state.dircache.delete(k);
            }
            // update state.pwdcache
            state.updatePwd(arg, (cmp) => {
                if (cmp)
                    state.pwdcache = cmp;
            });
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
        } else if (type === completions.DIR) {
            state.dircache = new Map();
        }
    },

    complete: function complete(data, cb) {
        let ret;

        let tok = tokenize(data.buffer, data.start, data.end);
        // console.log(data, tok);

        if (tok.tokens.length === 1) {
            let str = tok.tokens[0];

            // complete on commands and executable files
            ret = [];
            // are we completing on a directory?
            if (data.end > 0) {
                switch (str[0]) {
                case '/':
                case '.':
                    // yes, let's complete
                    let direxe = (stats) => {
                        if (stats.isDirectory())
                            return true;
                        if (isExe(stats))
                            return true;
                        return false;
                    };
                    state.dirComplete(data, tok, cb, direxe);
                    return;
                case '$':
                    state.expComplete(data, tok, cb);
                    return;
                default:
                    break;
                }
            }
            let execache = state.execache.items;
            for (let k = 0; k < execache.length; ++k) {
                if (execache[k].substr(0, data.end) == data.buffer)
                    ret.push(execache[k]);
            }
            //console.log("would send 1", ret);
            cb(ret);
            return;
        }

        if (tok.state == TokenizeState.Expansion) {
            state.expComplete(data, tok, cb);
            return;
        }

        for (let i = 0; i < state.completions; ++i) {
            if ((ret = state.completions[i].match(tok, data))) {
                console.log("would send 2", ret);
                cb();
                return;
            }
        }
        // console.log("complete", JSON.stringify(data, null, 4));
        cb();
    }
};

module.exports = completions;
