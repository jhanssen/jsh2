/*global require,module,process*/
const readline = require("native-readline");
const completions = require("./completions");

const state = {
    shell: undefined,
    histfile: undefined,

    init: function init(runner, histfile) {
        const Shell = require("./shell");
        state.shell = new Shell({ runner: runner });
        runner.shells.push(state.shell);

        state.histfile = histfile;
        readline.readHistory(histfile);
    },

    deinit: function deinit() {
        readline.writeHistory(state.histfile);
    },

    online: function online(line) {
        if (state.shell.process(line)) {
            readline.addHistory(line);
        }
    },

    oncomplete: function oncomplete(data, cb) {
        state.shell.complete(data, cb);
    }
};

module.exports = {
    run: function run(runner, histfile) {
        readline.start(state.online, state.oncomplete);
        process.on("SIGINT", () => {
            readline.prompt(() => {});
        });
        state.init(runner, histfile);
    },
    stop: function stop() {
        state.deinit();
    },
    rehash: function rehash() {
        // initialize path completions
        completions.update(completions.PATH, process.env.PATH);
    }
};
