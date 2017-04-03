/*global module,require*/

class Tokenizer
{
    constructor(b) {
        this.buffer = b;
    }

    parse() {
        let State = {
            Normal: 0,
            DoubleQuote: 1,
            SingleQuote: 2,
            Backtick: 3,
            Escape: 4,
            LineComment: 5,
            BlockComment: 6,
            Brace: 7,
            Paren: 8
        };
        let state = [State.Normal];
        let lastState = () => {
            return state[state.length - 1];
        };
        let indent = (ch) => {
            if (!ch)
                return ch;
            let i = state.length - 1;
            let ret = "";
            for (let idx = 0; idx < i; ++idx)
                ret += "...";
            return ret + " " + ch;
        };
        let stateToCh = () => {
            switch (lastState()) {
            case State.Normal:
                return undefined;
            case State.DoubleQuote:
                return '"';
            case State.SingleQuote:
                return '\'';
            case State.Backtick:
                return '`';
            case State.Escape:
                return '\\';
            case State.LineComment:
                return '//';
            case State.BlockComment:
                return '/*';
            case State.Brace:
                return '{';
            case State.Paren:
                return '(';
            }
            return undefined;
        };
        let maybePush = (s) => {
            if (state[state.length - 1] != s) {
                state.push(s);
                return true;
            }
            return false;
        };
        let maybePop = (s) => {
            if (state[state.length - 1] == s) {
                state.pop();
                return true;
            }
            return false;
        };
        for (let idx = 0; idx < this.buffer.length; ++idx) {
            switch (this.buffer[idx]) {
            case '\\':
                if (!maybePop(State.Escape))
                    state.push(State.Escape);
                break;
            case '"':
                switch (lastState()) {
                case State.DoubleQuote:
                    state.pop();
                    break;
                case State.Normal:
                case State.Paren:
                case State.Brace:
                    state.push(State.DoubleQuote);
                    break;
                case State.Escape:
                    state.pop();
                    break;
                }
                break;
            case '\'':
                switch (lastState()) {
                case State.SingleQuote:
                    state.pop();
                    break;
                case State.Normal:
                case State.Paren:
                case State.Brace:
                    state.push(State.SingleQuote);
                    break;
                case State.Escape:
                    state.pop();
                    break;
                }
                break;
            case '`':
                switch (lastState()) {
                case State.Backtick:
                    state.pop();
                    break;
                case State.Normal:
                case State.Paren:
                case State.Brace:
                    state.push(State.Backtick);
                    break;
                case State.Escape:
                    state.pop();
                    break;
                }
                break;
            case '/':
                switch (lastState()) {
                case State.Normal:
                    if (idx > 0 && this.buffer[idx - 1] == '/') {
                        state.push(State.LineComment);
                    } else if (idx + 1 < this.buffer.length && this.buffer[idx + 1] == '*') {
                        state.push(State.BlockComment);
                    }
                    break;
                case State.BlockComment:
                    if (idx > 0 && this.buffer[idx - 1] == '*') {
                        state.pop();
                    }
                    break;
                case State.Escape:
                    state.pop();
                    break;
                }
                break;
            case '\n':
                if (!maybePop(State.LineComment))
                    maybePop(State.Escape);
                break;
            case '{':
                switch (lastState()) {
                case State.Normal:
                case State.Brace:
                case State.Paren:
                    state.push(State.Brace);
                    break;
                case State.Backtick:
                    // maybe I should make this easier
                    if (idx > 0 && this.buffer[idx - 1] == '$') {
                        if (idx == 1 || this.buffer[idx - 2] != '\\')
                            state.push(State.Brace);
                    }
                    break;
                }
                maybePop(State.Escape);
                break;
            case '}':
                if (!maybePop(State.Brace))
                    maybePop(State.Escape);
                break;
            case '(':
                switch (lastState()) {
                case State.Normal:
                case State.Brace:
                case State.Paren:
                    state.push(State.Paren);
                    break;
                }
                maybePop(State.Escape);
                break;
            case ')':
                if (!maybePop(State.Paren))
                    maybePop(State.Escape);
                break;
            default:
                maybePop(State.Escape);
                break;
            }
        }
        return indent(stateToCh());
    }
};

module.exports = function countjs(buffer)
{
    // check that we have an even matching number of () and {}
    let tok = new Tokenizer(buffer);
    return tok.parse();
};
