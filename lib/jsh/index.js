/*global module,require*/

function JSH() {
    this.shells = [];
    this.commands = new this.Commands();
    this.assignments = new this.Assignments();
};

JSH.prototype = {
    value: function(v) {
        // if we can parseFloat then do that, if the string starts with a { or [ try to JSON.parse it.
        // otherwise return the string
        if (typeof v !== "string" || !v.length)
            return v;
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

((jsh) => {
    const all = require("./states");
    for (var k in all) {
        jsh[k] = all[k];
    }
    jsh.Command = require("./command");
})(JSH.prototype);

module.exports = JSH;
