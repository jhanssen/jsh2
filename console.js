/*global require,module*/
const readline = require("native-readline");
const Shell = require("./shell");
const jsh = require("./jsh");

const state = {
    shell: undefined,

    init: function init() {
        state.shell = new Shell();
        jsh.shells.push(state.shell);
    },

    readline: function readline(line) {
        state.shell.process(line);
    },

    complete: function complete(data, cb) {
        state.shell.complete(data, cb);
    }
};

module.exports = {
    run: function run() {
        state.init();
        readline.start(state.readline, state.complete);
    }
};
