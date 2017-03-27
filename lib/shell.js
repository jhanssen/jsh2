/*global require,module,process*/

"use strict";

const parser = require("bash-parser");
const readline = require("native-readline");
const completions = require("./completions");
const tokenizer = require("./tokenizer");
//const commands = require("./commands");
const CodeGenerator = require("./codegenerator");
const {NodeVM} = require("vm2");

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
    cached: undefined,

    init: function init(options) {
        var sb = {};
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

        this.parseOpts = { resolveEnv: this._resolveEnv.bind(this), resolvePath: this._resolvePath.bind(this) };
        this.cached = {};

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
    },

    rehash: function rehash() {
        this.cached = {};
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
        try {
            var ast;
            if (typeof input === "string") {
                ast = parser(input, this.parseOpts);
            } else {
                ast = input;
            }
            console.log("ast", JSON.stringify(ast, null, 4));
            this._processAst(ast);
            return true;
        } catch (e) {
            console.error(e.message);
        }
        return false;
    },

    complete: function complete(data, cb) {
        completions.complete(this, data, cb);
        // console.log("complete", JSON.stringify(data, null, 4));
        // cb();
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
        console.log("generated", code);
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
