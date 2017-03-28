/*global require,module,process*/

"use strict";

const binarysearch = require("binarysearch");
const fs = require("fs");
const path = require("path");
const commands = require("../commands");
const tokenizer = require("../tokenizer");
const nativeJsh = require("native-jsh");
const username = require("username");

class Completion
{
    constructor(name, ...args) {
        // set up completions
        // console.log("added completion for", name);
        this.name = name;
        this.completions = args;
    }

    match(tokens) {
        let n = tokens.tokens[0];
        if (this.name instanceof RegExp) {
            if (this.name.test(n))
                return this._match(tokens, 1, 0);
        } else if (this.name instanceof Function) {
            let ret = this.name(n);
            if (ret instanceof Promise)
                return ret;
            else if (ret === true)
                return this._match(tokens, 1, 0);
        } else if (this.name == n) {
            return this._match(tokens, 1, 0);
        }
        return false;
    }

    _extractTokens(tokens, tidx)
    {
        return { tokens: tokens.tokens.slice(tidx), cursor: { token: tokens.cursor.token - tidx, pos: tokens.cursor.pos }, text: tokens.text };
    }

    _match(tokens, tidx, cidx) {
        if (tokens.cursor.token == tidx) {
            // this is the token
            let c = this.completions[cidx];
            if (c instanceof Completion) {
                return c._match(tokens, tidx, 0);
            } else if (c instanceof Function) {
                return c(tokens, tidx);
            }
            return c;
        } else {
            if (tidx >= tokens.tokens.length)
                return true;
            let t = tokens.tokens[tidx];
            let c = this.completions[cidx];
            if (c instanceof RegExp) {
                if (c.test(t))
                    return this._match(tokens, tidx + 1, cidx + 1);
            } else if (c instanceof Completion) {
                return c.match(this._extractTokens(tokens, tidx));
            } else if (c instanceof Function) {
                let ret = c(t);
                if (ret instanceof Promise)
                    return ret;
                else if (ret == true)
                    return this._match(tokens, tidx + 1, cidx + 1);
            } else if (t == c) {
                return this._match(tokens, tidx + 1, cidx + 1);
            }
        }
        return true;
    }

    static get Invalid() { return 0; }
    static get Final() { return 1; }
    static get Partial() { return 2; }
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
    users: undefined,

    fixupExpansions: function fixupExpansions(tokens, start, output) {
        if (!output) {
            return false;
        }
        //console.log("fixup", output, tokens.expansions);
        // apply fixups, left to right for each output
        for (let idx = 0; idx < output.length; ++idx) {
            let mod = output[idx];
            for (let exp = 0; exp < tokens.expansions.length; ++exp) {
                let expansion = tokens.expansions[exp];
                let expanded = expansion.expanded;
                if (!expanded)
                    continue;
                let pre = mod.substr(0, expansion.pos);
                let post = mod.substr(expansion.pos + expanded.len);
                mod = (pre + expanded.was + post).substr();
            }
            output[idx] = mod.substr(start);
        }
        // console.log(output);
        return true;
    },

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

    dirComplete: function dirComplete(start, tokens, cb, cmp) {
        if (!tokens.tokens.length || tokens.cursor.token === undefined) {
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

        const complete = (key, token, cb) => {
            let obj;
            if ((obj = state.dircache.get(key))) {
                // console.log("got it");
                let ret = filter(token, obj);
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
                        if (!rem) {
                            cb();
                            return;
                        }
                        const done = () => {
                            if (!--rem) {
                                state.dircache.set(key, ret);
                                let newret = filter(token, ret);
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
                                let c = cmp(stats);
                                if (c !== Completion.Invalid) {
                                    ret.push({ fn: fn + ((c === Completion.Final) ? " " : ""), dir: stats.isDirectory() });
                                }
                                done();
                            });
                        }
                    }
                });
            }
        };

        let fixup = (ret) => {
            if (state.fixupExpansions(tokens, start, ret)) {
                cb(ret);
                return;
            }
            cb();
        };

        // find the last '/', everything up until that is our path
        let str = tokens.expanded[tokens.cursor.token].substr(0, tokens.cursor.pos + tokens.adjustCursor);
        let slash = str.lastIndexOf('/');
        if (slash == -1) {
            // we might still start with a '.'
            if (str[0] === '.') {
                complete("./", str, fixup);
            } else {
                cb();
            }
            return;
        }
        complete(str.substr(0, slash + 1), str, fixup);
    },

    expComplete: function expComplete(env, tok, exp, cb) {
        if (exp.text.length > 0 && exp.text[0] == '~') {
            // user expansion
            let user = exp.text.substr(1);
            if (state.users == undefined)
                state.users = nativeJsh.users();
            let ret = [];
            for (let idx = 0; idx < state.users.length; ++idx) {
                if (state.users[idx].name.substr(0, user.length) == user)
                    ret.push(`~${state.users[idx].name}`);
            }
            if (ret.length == 1 && ret[0] == user)
                return false;
            cb(ret);
            return true;
        }

        let start = exp.pos + 1;
        let txt = tok.tokens[exp.token];
        let sub = txt.substr(start, tok.cursor.pos - start);
        let brace = false;
        if (sub.length > 0 && sub[0] == '{') {
            brace = true;
            sub = sub.substr(1);
        }
        let ret = [];
        for (var k in env) {
            if (k.substr(0, sub.length) == sub)
                ret.push(k);
        }
        if (ret.length == 1 && ret[0] == sub)
            return false;
        if (!ret.length && brace && sub[sub.length - 1] == '}')
            return false;

        //console.log("expansion complete", exp, tok, sub, ret);
        cb(ret);
        return true;
    },

    expand: function expand(shell, tokens) {
        tokens.adjustCursor = 0;
        // perform expansions, back to front

        if (tokens.expansions.length > 0) {
            let expanded = tokens.tokens.slice(0);

            let expandToken = (token, pos, len) => {
                let exp = expanded[token].substr(pos, len);
                if (!exp.length)
                    return -1;
                if (exp[0] == "~") {
                    // expand user
                    let user = exp.substr(1);
                    if (!user.length) {
                        // current user
                        user = username.sync();
                    }
                    if (user.length) {
                        if (state.users == undefined)
                            state.users = nativeJsh.users();
                        for (let idx in state.users) {
                            if (state.users[idx].name == user) {
                                // replace with homedir
                                let pre = expanded[token].substr(0, pos);
                                let post = expanded[token].substr(pos + len);
                                expanded[token] = pre + state.users[idx].dir + post;
                                return state.users[idx].dir.length;
                            }
                        }
                    }
                } else if (exp[0] == "$") {
                    // expand env
                    let env;
                    if (exp.length > 1 && exp[1] == "{") {
                        // skip unterminated brace expansion
                        if (exp[exp.length - 1] != "}")
                            return -1;
                        env = exp.substr(2, exp.length - 3);
                    } else {
                        env = exp.substr(1);
                    }
                    for (var k in shell.env) {
                        if (k == env) {
                            let pre = expanded[token].substr(0, pos);
                            let post = expanded[token].substr(pos + len);
                            expanded[token] = pre + shell.env[k] + post;
                            return shell.env[k].length;
                        }
                    }

                }
                return -1;
            };

            let off = 1;
            // treat the last one as a special expansion, it might be incomplete
            if (tokens.state === tokenizer.State.Expansion) {
                let expansion = tokens.expansions[tokens.expansions.length - 1];
                if (expanded[expansion.token].substr(expansion.pos + 1, 1) == '{')
                    off = 2;
            }

            for (let idx = tokens.expansions.length - off; idx >= 0; --idx) {
                let expansion = tokens.expansions[idx];
                let len = expandToken(expansion.token, expansion.pos, expansion.len);
                if (len != -1) {
                    tokens.expansions[idx].expanded = { len: len, was: tokens.tokens[expansion.token].substr(expansion.pos, expansion.len) };
                    if (tokens.cursor.token > expansion.token
                        || (tokens.cursor.token == expansion.token && tokens.cursor.pos >= expansion.pos + expansion.len))
                        tokens.adjustCursor += len - expansion.len;
                }
            }

            tokens.expanded = expanded;
            //console.log(tokens);
        } else {
            tokens.expanded = tokens.tokens;
        }
    }
};

const completions = {
    Completion: Completion,

    register: function register(completion) {
        state.completions.push(completion);
    },

    PWD: 0,
    PATH: 1,
    DIR: 2,
    USERS: 3,

    update: function update(type, arg) {
        switch (type) {
        case completions.PWD:
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
            break;
        case completions.PATH:
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
            break;
        case completions.DIR:
            state.dircache = new Map();
            break;
        case completions.USERS:
            state.users = undefined;
            break;
        }
    },

    complete: function complete(shell, data, cb) {
        let ret;

        let tok = tokenizer.tokenize(data);
        // console.log(data, tok);

        state.expand(shell, tok);

        // are we completing in an expansion?
        let cursor = tok.cursor;
        for (let i = 0; i < tok.expansions.length; ++i) {
            let exp = tok.expansions[i];
            if (cursor.token == exp.token) {
                // maybe
                if (cursor.pos > exp.pos && cursor.pos <= exp.pos + exp.len) {
                    // yes
                    if (state.expComplete(shell.env, tok, exp, cb)) {
                        return;
                    }
                }
            }
        }

        if (tok.cursor.token === 0) {
            let str = tok.expanded[0].substr(0, tok.cursor.pos + tok.adjustCursor);
            // console.log(str);

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
                            return Completion.Partial;
                        if (isExe(stats))
                            return Completion.Final;
                        return Completion.Invalid;
                    };
                    state.dirComplete(data.start, tok, cb, direxe);
                    return;
                default:
                    break;
                }
            }
            let execache = state.execache.items;
            for (let k = 0; k < execache.length; ++k) {
                if (execache[k].substr(0, tok.cursor.pos) == str)
                    ret.push(execache[k]);
            }
            //console.log("would send 1", ret);
            cb(ret);
            return;
        }

        let textFunc = function() {
            return this.tokens[cursor.token].substr(0, cursor.token.pos);
        };
        let ext = { tokens: tok.expanded, cursor: { token: tok.cursor.token, pos: tok.cursor.pos + tok.adjustCursor }, text: textFunc };
        //console.log("bb", data, ext);
        let fixup = (ret) => {
            if (state.fixupExpansions(tok, 0, ret)) {
                cb(ret);
                return;
            }
            cb();
        };
        let comp = function*() {
            for (let i = 0; i < state.completions.length; ++i) {
                if ((ret = state.completions[i].match(ext))) {
                    if (ret instanceof Promise) {
                        if (!(yield ret))
                            return;
                    } else if (ret instanceof Array) {
                        fixup(ret);
                        return;
                    } else {
                        // unexpected completion
                        fixup();
                        return;
                    }
                }
            }
            // console.log("complete", JSON.stringify(data, null, 4));
            fixup();
        };
        let resolved = false;
        let c = comp();
        let next = (promise) => {
            promise.then((r) => {
                resolved = true;
                if (r instanceof Promise) {
                    next(promise);
                } else {
                    //console.log("would send 2.1", r);
                    fixup(r);
                    // finish up the generator
                    c.next(false);
                }
            }).catch((err) => {
                console.log("complete error", err);
                if (!resolved) {
                    let done = c.next(true);
                    if (done.value instanceof Promise)
                        next(done.value);
                } else {
                    c.next(false);
                    fixup();
                }
            });
        };
        //setTimeout(fixup, 2000);
        let done = c.next();
        if (done.value instanceof Promise) {
            next(done.value);
        }
    }
};

module.exports = completions;
