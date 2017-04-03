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

function isGlob(path)
{
    let globchars = new Set(['[', '{', '*', '?', '+', '@', '!']);
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
            }
            resetEscape();
            break;
        }
    }
    return false;
}

function Shell(options)
{
    this.init(options);
}

Shell.prototype = {
    vm: undefined,
    generator: undefined,
    runner: undefined,
    parseOpts: undefined,
    users: undefined,
    user: undefined,
    jsmode: undefined,
    jsctx: undefined,

    get js() { return this.jsmode; },
    set js(on) { this.jsmode = on; if (on) this.jsctx = nativevm.createContext({}); },

    init: function init(options) {
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
    },

    rehash: function rehash() {
        this.users = undefined;
    },

    get environment() {
        // var env = {};
        // this._duplicate(this.vm._context, env);
        // return env;
        return this.env;
    },

    setenv: function setenv(key, value) {
        // if (!Shell._disallowedKeys.has(key))
        //     this.vm._context[key] = value;
        this.env[key] = value + "";
    },

    setvar: function setvar(key, value) {
        this.vars[key] = value + "";
    },

    process: function process(input) {
        if (this.jsmode) {
            if (input.trim() == "exit") {
                this.jsmode = false;
                return true;
            }
            try {
                let res = nativevm.runInContext(input, this.jsctx);
                console.log(res);
            } catch (e) {
                console.error(e.message);
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
    },

    complete: function complete(data, cb) {
        completions.complete(this, data, cb);
        // console.log("complete", JSON.stringify(data, null, 4));
        // cb();
    },

    escape: function escape(args) {
        let str = "";
        for (let idx = 0; idx < args.length; ++idx) {
            if (idx > 0)
                str += " ";
            str += "'" + (args[idx] + "").replace(/'/g, "\\'") + "'";
        }
        return str;
    },

    run: function run(...input) {
        let line, async = false, detached = false;
        if (input.length == 1) {
            if (typeof input[0] === "string") {
                line = input[0];
            } else if (typeof input[0] === "object") {
                if (input[0].line instanceof Array) {
                    line = this.escape(input[0].line);
                } else if (typeof input[0] === "string") {
                    line = input[0].line;
                } else {
                    throw "Invalid line in shell.run()";
                }
                async = (input[0].async === true || input[0].detached === true);
                detached = input[0].detached === true;
            }
        }
        if (line === undefined)
            line = this.escape(input);

        return new Promise((resolve, reject) => {
            const CodeRunner = require("./coderunner/index");
            const opts = {
                io: {
                    _out: "",
                    _err: "",
                    stdout: function(o) {
                        opts.io._out += o;
                    },
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
            if (opts.asyncOverride) {
                opts.io.stderr = function(e) {
                    opts.io._err += e;
                };
            }
            let runner = new CodeRunner(opts);
            runner.shells.push(this);
            try {
                const ast = parser(line, this.parseOpts);
                const code = this.generator.generate(ast);
                const fn = this.vm.run(code);
                fn(runner).catch((e) => { reject(e); });
            } catch (e) {
                // console.error(e.message);
                // console.error(e.stack);
                reject(e);
            }
        });
    },

    runDetached: function(...input) {
        return this.run({ line: input, detached: true });
    },

    _resolveAlias: function _resolveAlias(alias) {
        if (this.aliases) {
            let v = this.aliases.get(alias);
            if (v !== undefined)
                return v;
        }
        return alias;
    },

    _resolveEnv: function _resolveEnv(env) {
        // if (!Shell._disallowedKeys.has(env) && env in this.vm._context && typeof this.vm._context[env] !== "function")
        //     return "" + this.vm._context[env];
        // return null;
        if (env in this.vars)
            return this.vars[env];
        if (env in this.env)
            return this.env[env];
        return null;
    },

    _resolvePath: function _resolvePath(path) {
        // return magic value if we should do globbing
        if (isGlob(path))
            return "${glob:" + path + "}";
        return path;
    },

    _resolveHomeUser: function _resolveHomeUser(username) {
        username = username || this.user;
        if (!this.users) {
            this.users = nativeJsh.users();
        }

        return this._findUser(username).dir || "";
    },

    _findUser: function _findUser(username) {
        if (!this.users)
            return {};
        for (var idx = 0; idx < this.users.length; ++idx) {
            if (this.users[idx].name === username)
                return this.users[idx];
        }
        return {};
    },

    // _resolveParameter: function _resolveParameter(param) {
    //     // need to handle . syntax here, i.e. if given foo.bar resolve that to the bar property value of the foo object
    //     // but we also need to handle key names with . in them, i.e. global["foo.bar"] = 5
    //     if (!Shell._disallowedKeys.has(param) && param in this.vm._context && typeof this.vm._context[param] !== "function")
    //         return "" + this.vm._context[param];
    //     return "";
    // },

    _duplicate: function(from, to) {
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
    },

    _processAst: function _processAst(ast) {
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
};

Shell._disallowedKeys = new Set(["process", "console", "parent", "Buffer", "VMError",
                                 "setTimeout", "setInterval", "setImmediate",
                                 "clearTimeout", "clearInterval", "clearImmediate"]);

module.exports = { Shell: Shell };
