/*global require,module,process*/

"use strict";

const parser = require("bash-parser");
const readline = require("native-readline");
const nativeJsh = require("native-jsh");
const completions = require("./completions");
const tokenizer = require("./tokenizer");
//const commands = require("./commands");
const CodeGenerator = require("./codegenerator");
const {NodeVM} = require("vm2");
const nativevm = require("vm");
const EventEmitter = require("events");

function isGlob(path)
{
    let globchars = new Set(['[', '{', '*', '?']);
    let special = new Set(['+', '@', '!']);
    // if we find any char in globchars that's not quoted and not escaped then let's glob
    let State = { Normal: 0, SingleQuote: 1, DoubleQuote: 2, Escape: 3 };
    let state = State.Normal;
    let resetEscape = () => {
        if (state == State.Escape)
            state = State.Normal;
    };
    for (let idx = 0; idx < path.length; ++idx) {
        switch (path[idx]) {
        case "'":
            if (state == State.Normal)
                state = State.SingleQuote;
            else if (state == State.SingleQuote)
                state = State.Normal;
            resetEscape();
            break;
        case "\"":
            if (state == State.Normal)
                state = State.DoubleQuote;
            else if (state == State.DoubleQuote)
                state = State.Normal;
            resetEscape();
            break;
        case "\\":
            if (state != State.Escape)
                state = State.Escape;
            else
                resetEscape();
            break;
        default:
            if (state == State.Normal) {
                if (globchars.has(path[idx]))
                    return true;
                if (idx + 1 < path.length && path[idx + 1] == '(' && special.has(path[idx]))
                    return true;
            }
            resetEscape();
            break;
        }
    }
    return false;
}

class Shell extends EventEmitter
{
    constructor(options) {
        super();

        var sb = {};
        this.jsmode = false;
        if (options) {
            this.runner = options.runner;
            if (options.parent) {
                // this is very hacky, I shouldn't have to know about the context
                this._duplicate(options.parent.vm._context, sb);

                // what's set in parent gets propagated to the parent shell on subshell exit
                sb.parent = {};

                this.parent = options.parent;
            }
        }

        this.parseOpts = {
            resolveAlias: this._resolveAlias.bind(this),
            resolveEnv: this._resolveEnv.bind(this),
            resolvePath: this._resolvePath.bind(this),
            resolveHomeUser: this._resolveHomeUser.bind(this)
        };

        this.vm = new NodeVM({ console: "redirect", sandbox: sb, require: true });

        if (options && options.redirect) {
            this.vm.on("console.log", (...args) => {
                options.redirect.stdout(...args);
            });
            this.vm.on("console.error", (...args) => {
                options.redirect.stderr(...args);
            });
        } else {
            this.vm.on("console.log", (...args) => {
                console.log(...args);
            });
            this.vm.on("console.error", (...args) => {
                console.error(...args);
            });
        }
        // the rest are lost in the ether

        this.generator = new CodeGenerator();

        this.env = {};
        for (let k in process.env) {
            this.env[k] = process.env[k];
        }
        this.vars = {};

        this.user = require("username").sync();
    }

    get js() { return this.jsmode; }
    set js(on) {
        if (on == this.jsmode)
            return;
        this.jsmode = on;
        if (on) {
            this.jsctx = nativevm.createContext({});
            this.emit("modeChange", "js");
        } else {
            this.emit("modeChange", "sh");
        }
    }

    get lastStatus() { return this.status; }
    set lastStatus(s) { this.status = s; process.nextTick(() => { this.emit("jobComplete", s); }); }

    rehash() {
        this.users = undefined;
    }

    get environment() {
        // var env = {};
        // this._duplicate(this.vm._context, env);
        // return env;
        return this.env;
    }

    setenv(key, value) {
        // if (!Shell._disallowedKeys.has(key))
        //     this.vm._context[key] = value;
        this.env[key] = value + "";
    }

    setvar(key, value) {
        this.vars[key] = value + "";
    }

    process(input) {
        process.nextTick(() => { this.emit("processed"); });
        if (this.jsmode) {
            if (input.trim() == "exit") {
                this.js = false;
                return true;
            }

            // taken from nodes REPL
            let code = input;
            let wrappedCmd = false;
            if (/^\s*\{/.test(code) && /\}\s*$/.test(code)) {
                // It's confusing for `{ a : 1 }` to be interpreted as a block
                // statement rather than an object literal.  So, we first try
                // to wrap it in parentheses, so that it will be interpreted as
                // an expression.
                code = `(${code.trim()})\n`;
                wrappedCmd = true;
            }

            let done = false;
            while (!done) {
                try {
                    let res = nativevm.runInContext(code, this.jsctx);
                    console.log(res);
                    return true;
                } catch (e) {
                    if (wrappedCmd) {
                        // try again, unwrapped
                        code = input;
                        wrappedCmd = false;
                    } else {
                        done = true;
                        console.error(e.message);
                    }
                }
            }
            return false;
        }
        try {
            var ast;
            if (typeof input === "string") {
                ast = parser(input, this.parseOpts);
            } else {
                ast = input;
            }
            // console.log("ast", JSON.stringify(ast, null, 4));
            this._processAst(ast);
            return true;
        } catch (e) {
            console.error(e.message);
            console.error(e.stack);
        }
        return false;
    }

    complete(data, cb) {
        completions.complete(this, data, cb);
        // console.log("complete", JSON.stringify(data, null, 4));
        // cb();
    }

    escape(args) {
        let str = "";
        for (let idx = 0; idx < args.length; ++idx) {
            if (typeof args[idx] !== "string" || !args[idx].length)
                continue;
            if (idx > 0)
                str += " ";
            str += "'" + (args[idx] + "").replace(/'/g, "\\'") + "'";
        }
        return str;
    }

    run(...input) {
        let command, async = false, detached = false, fg = false;
        if (input.length == 1) {
            if (typeof input[0] === "string") {
                command = input[0];
            } else if (typeof input[0] === "object") {
                if (input[0].command instanceof Array) {
                    command = this.escape(input[0].command);
                } else if (typeof input[0] === "string") {
                    command = input[0].command;
                } else {
                    throw "Invalid command in shell.run()";
                }
                async = (input[0].async === true || input[0].detached === true);
                detached = input[0].detached === true;
                fg = input[0].fg === true;
                if (fg) {
                    async = false;
                    detached = false;
                }
            }
        }
        if (command === undefined)
            command = this.escape(input);

        return new Promise((resolve, reject) => {
            const CodeRunner = require("./coderunner/index");
            const opts = {
                io: {
                    _out: "",
                    _err: "",
                    close: function(status) {
                        if (!status) {
                            resolve({ stdout: opts.io._out, stderr: opts.io._err});
                            return;
                        }
                        reject(status);
                    }
                },
                asyncOverride: async === true,
                detached: detached
            };
            if (!fg) {
                opts.io.stdout = function(o) {
                    opts.io._out += o;
                };
            }
            if (opts.asyncOverride) {
                opts.io.stderr = function(e) {
                    opts.io._err += e;
                };
            }
            let runner = new CodeRunner(opts);
            runner.shells.push(this);
            try {
                const ast = parser(command, this.parseOpts);
                const code = this.generator.generate(ast);
                const fn = this.vm.run(code);
                fn(runner).catch((e) => { reject(e); });
            } catch (e) {
                // console.error(e.message);
                // console.error(e.stack);
                reject(e);
            }
        });
    }

    runDetached(...input) {
        return this.run({ command: input, detached: true });
    }

    _resolveAlias(alias) {
        if (this.aliases) {
            let v = this.aliases.get(alias);
            if (v !== undefined)
                return v;
        }
        return alias;
    }

    _resolveEnv(env) {
        // if (!Shell._disallowedKeys.has(env) && env in this.vm._context && typeof this.vm._context[env] !== "function")
        //     return "" + this.vm._context[env];
        // return null;
        if (env in this.vars)
            return this.vars[env];
        if (env in this.env)
            return this.env[env];
        return null;
    }

    _resolvePath(path) {
        // return magic value if we should do globbing
        if (isGlob(path))
            return "${glob:" + path + "}";
        return path;
    }

    _resolveHomeUser(username) {
        username = username || this.user;
        if (!this.users) {
            this.users = nativeJsh.users();
        }

        return this._findUser(username).dir || "";
    }

    _findUser(username) {
        if (!this.users)
            return {};
        for (var idx = 0; idx < this.users.length; ++idx) {
            if (this.users[idx].name === username)
                return this.users[idx];
        }
        return {};
    }

    // _resolveParameter(param) {
    //     // need to handle . syntax here, i.e. if given foo.bar resolve that to the bar property value of the foo object
    //     // but we also need to handle key names with . in them, i.e. global["foo.bar"] = 5
    //     if (!Shell._disallowedKeys.has(param) && param in this.vm._context && typeof this.vm._context[param] !== "function")
    //         return "" + this.vm._context[param];
    //     return "";
    // }

    _duplicate(from, to) {
        var seen = [];
        var illegal = new Set();
        const find = function(from) {
            for (var i = 0; i < seen.length; i += 2) {
                if (seen[i] === from)
                    return seen[i + 1];
            }
            return null;
        };
        const copy = function(from, to) {
            // should optimize this if we can
            for (var k in from) {
                if (illegal.has(from[k]))
                    continue;
                if (typeof from[k] == "object") {
                    const found = find(from[k]);
                    if (found) {
                        to[k] = found;
                        continue;
                    }
                    if (from[k] instanceof Array)
                        to[k] = [];
                    else
                        to[k] = {};
                    seen.push(from[k]);
                    seen.push(to[k]);
                    copy(from[k], to[k]);
                    // } else if (typeof from[k] == "function") {
                    //     // skip functions
                } else {
                    to[k] = from[k];
                }
            }
        };
        for (var k of Shell._disallowedKeys) {
            if (k in from)
                illegal.add(from[k]);
        }
        copy(from, to);
    }

    _processAst(ast) {
        const code = this.generator.generate(ast);
        // console.log("generated", code);
        // run in shell
        let fn = this.vm.run(code);
        readline.pause(() => {
            let resume = (log, obj, ...msg) => {
                readline.resume(() => {
                    if (log)
                        log.call(obj, ...msg);
                });
            };
            fn(this.runner)
                .then(() => resume())
                .catch(err => resume(console.error, console, "exception", err));
        });
    }
}

Shell._disallowedKeys = new Set(["process", "console", "parent", "Buffer", "VMError",
                                 "setTimeout", "setInterval", "setImmediate",
                                 "clearTimeout", "clearInterval", "clearImmediate"]);

module.exports = { Shell: Shell };
