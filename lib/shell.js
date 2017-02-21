/*global require,module*/

"use strict";

const parser = require("bash-parser");
const commands = require("./commands");
const CodeGenerator = require("./codegenerator");
const {NodeVM} = require("vm2");

function Shell(options)
{
    this.init(options);
}

Shell.prototype = {
    vm: undefined,
    generator: undefined,

    init: function init(options) {
        var sb = {};
        if (options && options.parent) {
            // this is very hacky, I shouldn't have to know about the context
            this._duplicate(options.parent.vm._context, sb);

            // what's set in parent gets propagated to the parent shell on subshell exit
            sb.parent = {};

            this.parent = options.parent;
        }

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
    },

    get environment() {
        var env = {};
        this._duplicate(this.vm._context, env);
        return env;
    },

    set: function set(key, value) {
        if (!Shell._disallowedKeys.has(key))
            this.vm._context[key] = value;
    },

    process: function process(input) {
        try {
            var ast;
            if (typeof input === "string")
                ast = parser(input, { resolveEnv: this._resolveEnv.bind(this) });
            else
                ast = input;
            console.log("ast", JSON.stringify(ast, null, 4));
            this._processAst(ast);
        } catch (e) {
            console.error(e.message);
        }
    },

    complete: function complete(data, cb) {
        console.log("complete", JSON.stringify(data, null, 4));
        cb();
    },

    _resolveEnv: function _resolveEnv(env) {
        if (!Shell._disallowedKeys.has(env) && env in this.vm._context && typeof this.vm._context[env] !== "function")
            return "" + this.vm._context[env];
        return null;
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

    _commands: {
        Command: function(cmd) {
            if (cmd.name.type == "Word") {
                const call = commands.find(cmd.name.text);
                if (call && typeof call.cmd === "function") {
                    const jsh = {
                        shell: new Shell({ parent: this, callOpts: call.opts })
                    };
                    // naive approach for now
                    let args = [jsh];
                    if ("suffix" in cmd) {
                        for (var a = 0; a < cmd.suffix.length; ++a) {
                            args.push(cmd.suffix[a].text);
                        }
                    }
                    if (commands.isGenerator(call.cmd)) {
                        let gen = call.cmd.apply(call.cmd, args);
                        let res = gen.next();
                        if (!res.done) {
                            // this means we've yielded for stdin
                            if (res.value !== undefined) {
                                // forward to the next in the chain
                            }
                        }
                    } else {
                        let ret = call.cmd.apply(call.cmd, args);
                        // blah
                    }
                }
            } else {
                // this might be a native program
            }
        }
    },

    _processAst: function _processAst(ast) {
        for (var i = 0; i < ast.commands.length; ++i) {
            if (ast.commands[i].type in this._commands)
                this._commands[ast.commands[i].type].call(this, ast.commands[i]);
        }
        const code = this.generator.generate(ast);
        console.log("generated", code);
    }
};

Shell._disallowedKeys = new Set(["process", "console", "parent", "Buffer", "VMError",
                                 "setTimeout", "setInterval", "setImmediate",
                                 "clearTimeout", "clearInterval", "clearImmediate"]);

module.exports = Shell;
