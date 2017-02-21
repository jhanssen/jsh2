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

class Assignments {
    constructor() {
        this.assignments = [];
    }

    push(assignment) {
        this.assignments.push(assignment);
    }

    pop(assignment) {
        this.assignments.pop();
    }

    clone() {
        // copy the objects
        let dup = (obj) => {
            let out = {};
            for (let k in obj) {
                out[k] = obj[k];
            }
            return out;
        };

        let out = [];
        for (let i = 0; i < this.assignments.length; ++i) {
            out.push(dup(this.assignments[i]));
        }
        return out;
    }
}

class CommandBase {
    constructor() {
        this.commands = [];
        this.subscriptions = [];
        this.state = undefined;
    }

    add(cmd) {
        this.commands.push(cmd);
    }

    subscribe(cb) {
        this.subscriptions.push(cb);
        if (this.state !== undefined)
            cb(this.state);
    }

    _notify(state) {
        this.state = state;
        for (let i = 0; i < this.subscriptions.length; ++i)
            this.subscriptions[i](state);
    }
}

class CommandRunner extends CommandBase {
    run() {
        for (let i = 0; i < this.commands.length; ++i) {
            this.commands[i].run();
        }
    }
};

module.exports = { Commands: Commands, Assignments: Assignments, CommandRunner: CommandRunner };
