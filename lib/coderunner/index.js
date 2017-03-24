/*global require,module*/

function CodeRunner()
{
    this.shells = [];
    //this.commands = new this.Commands();
    this.assignments = new this.Assignments();
}

CodeRunner.prototype = {
    get shell() {
        if (this.shells.length > 0)
            return this.shells[this.shells.length - 1];
        return undefined;
    },

    value: function(v) {
        // if we can parseFloat then do that, if the string starts with a { or [ try to JSON.parse it.
        // otherwise return the string
        if (typeof v !== "string" || !v.length) {
            if (v instanceof this.Glob) {
                return v.values;
            }
            return v;
        }
        var r = parseFloat(v);
        if (!isNaN(r)) {
            return r;
        }
        if (v[0] == "{" || v[0] == "[") {
            try {
                r = JSON.parse(v);
                return r;
            } catch (e) {
            }
        }
        return v;
    }
};

((proto) => {
    proto.Command = require("./command");
    proto.CommandPipeline = require("./commandpipeline");
    proto.CommandRunner = require("./commandrunner");
    proto.CommandExpander = require("./commandexpander");
    proto.Assignments = require("./assignments");
    proto.Glob = require("./glob").Glob;
    proto.expandAssignment = function(a) {
        if (a in this.assignments)
            return this.assignments.get(a);
        if (a in this.shell.vars)
            return this.shell.vars[a];
        if (a in this.shell.env)
            return this.shell.env[a];
        return "";
    };
    proto.globMatch = require("./glob").match;
})(CodeRunner.prototype);

module.exports = CodeRunner;
