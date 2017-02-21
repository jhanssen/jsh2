/*global require,module*/

class Commands {
    constructor() {
        this.commands = [];
    }

    push(cmds) {
        this.commands.push(cmds);
    }

    add(cmd) {
        this.commands[this.commands.length - 1].add(cmd);
    }

    pop() {
        this.commands[this.commands.length - 1].run();
        this.commands.pop();
    }

    subscribe(cb) {
        this.commands[this.commands.length - 1].subscribe(cb);
    }
}

module.exports = { Commands: Commands };
