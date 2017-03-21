/*global require,module,process*/
const readline = require("native-readline");
const completions = require("./completions");

const state = {
    shell: undefined,
    histfile: undefined,
    buffer: "",

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
        // if line ends with '\\', buffer up and concat
        if (line.length > 0 && line[line.length - 1] == '\\') {
            state.buffer += line;
            readline.overridePrompt("> ");
            return;
        }
        if (state.buffer.length > 0) {
            readline.restorePrompt();
            line = state.buffer + line;
            state.buffer = "";
        }
        if (state.shell.process(line)) {
            readline.addHistory(line);
        }
    },

    oncomplete: function oncomplete(data, cb) {
        state.shell.complete(data, cb);
    },

    onterm: function onterm(t) {
        state.shell.setvar("LINES", t.rows);
        state.shell.setvar("COLUMNS", t.cols);
    }
};

module.exports = {
    run: function run(runner, histfile) {
        readline.start(state.online, state.oncomplete);
        readline.setTerm(state.onterm);
        process.on("SIGINT", () => {
            state.buffer = "";
            readline.sigint();
        });
        state.init(runner, histfile);
    },
    stop: function stop() {
        state.deinit();
    },
    rehash: function rehash() {
        // initialize path completions
        completions.update(completions.PATH, process.env.PATH);
        completions.update(completions.DIR);
        completions.update(completions.USERS);
    },
    setPrompt: function setPrompt(func) {
        readline.setPrompt(func);
    }
};
