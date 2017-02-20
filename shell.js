/*global require,module*/

"use strict";

const parser = require("bash-parser");
const commands = require("./commands");
const {NodeVM} = require("vm2");

function Shell(parent)
{
    this.init(parent);
}

Shell.prototype = {
    vm: undefined,

    init: function init(parent) {
        var sb = {};
        if (parent) {
            // this is very hacky, I shouldn't have to know about the context
            this._duplicate(parent.vm._context, sb);

            // what's set in parent gets propagated to the parent shell on subshell exit
            sb.parent = {};

            this.parent = parent;
        }

        this.vm = new NodeVM({ console: "redirect", sandbox: sb, require: true });
        this.vm.on("console.log", (...args) => {
            console.log("got out", ...args);
            // write to stdout
        });
        this.vm.on("console.error", (...args) => {
            // write to stderr
        });
        // the rest are lost in the ether
    },

    get environment() {
        var env = {};
        this._duplicate(this.vm._context, env);
        return env;
    },

    process: function process(line) {
        try {
            const ast = parser(line, { resolveEnv: this._resolveEnv.bind(this), resolveParameter: this._resolveParameter.bind(this) });
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

    _resolveParameter: function _resolveParameter(param) {
        // need to handle . syntax here, i.e. if given foo.bar resolve that to the bar property value of the foo object
        // but we also need to handle key names with . in them, i.e. global["foo.bar"] = 5
        if (!Shell._disallowedKeys.has(param) && param in this.vm._context && typeof this.vm._context[param] !== "function")
            return "" + this.vm._context[param];
        return "";
    },

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
                } else if (typeof from[k] == "function") {
                    // skip functions
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
                if (call && typeof call === "function") {
                    const jsh = {
                        shell: this
                    };
                    // naive approach for now
                    let args = [jsh];
                    if ("suffix" in cmd) {
                        for (var a = 0; a < cmd.suffix.length; ++a) {
                            args.push(cmd.suffix[a].text);
                        }
                    }
                    if (commands.isGenerator(call)) {
                        let gen = call.apply(call, args);
                        let res = gen.next();
                        if (!res.done) {
                            // this means we've yielded for stdin
                            if (res.value !== undefined) {
                                // forward to the next in the chain
                            }
                        }
                    } else {
                        let ret = call.apply(call, args);
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
    }
};

Shell._disallowedKeys = new Set(["process", "console", "parent", "Buffer"]);

module.exports = Shell;
