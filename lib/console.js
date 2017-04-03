/*global require,module,process*/
const readline = require("native-readline");
const completions = require("./completions");

const state = {
    shell: undefined,
    normalHistFile: undefined,
    jsHistFile: undefined,
    curHistFile: undefined,
    buffer: "",

    init: function init(nhistfile, jhistfile) {
        const CodeRunner = require("./coderunner/index");
        const runner = new CodeRunner();

        const Shell = require("./shell").Shell;
        state.shell = new Shell({ runner: runner });
        runner.shells.push(state.shell);

        state.normalHistFile = nhistfile;
        state.jsHistFile = jhistfile;
        state.curHistFile = nhistfile;

        readline.readHistory(nhistfile);

        state.shell.on("modeChange", (mode) => {
            if (mode == "js")
                state.setHistory(state.jsHistFile);
            else
                state.setHistory(state.normalHistFile);
        });
    },

    countJS: require("./countjs"),

    deinit: function deinit() {
        readline.writeHistory(state.curHistFile);
        readline.stop();
    },

    setHistory: function setHistory(histfile)
    {
        // console.log("history is now", histfile);
        readline.writeHistory(state.curHistFile);
        readline.clearHistory();
        readline.readHistory(histfile);
        state.curHistFile = histfile;
    },

    online: function online(line) {
        // if line ends with '\\', buffer up and concat
        if (line.length > 0 && line[line.length - 1] == '\\') {
            if (!state.buffer.length)
                readline.overridePrompt("> ");
            state.buffer += line.substr(0, line.length - 1);
            return;
        }
        // if we're in js mode and our brace/paranthesis count is > 0, buffer up and concat
        if (state.shell.js) {
            let ch = state.countJS(state.buffer + line);
            if (ch !== undefined) {
                readline.overridePrompt(ch + " ");
                state.buffer += line;
                return;
            }
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
    shell: function shell() { return state.shell; },
    run: function run(nhistfile, jhistfile) {
        readline.start(state.online, state.oncomplete);
        readline.setTerm(state.onterm);
        process.on("SIGINT", () => {
            state.buffer = "";
            readline.sigint();
        });
        state.init(nhistfile, jhistfile);
    },
    stop: function stop() {
        state.deinit();
    },
    rehash: function rehash() {
        // initialize path completions
        state.shell.rehash();
        completions.update(completions.PATH, process.env.PATH);
        completions.update(completions.DIR);
        completions.update(completions.USERS);
    },
    setPrompt: function setPrompt(func) {
        readline.setPrompt(func);
    }
};
