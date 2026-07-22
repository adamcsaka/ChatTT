class RecorderProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._isRecording = false;
        this.port.onmessage = (event) => {
            if (event.data.command === 'START') {
                this._isRecording = true;
            } else if (event.data.command === 'STOP') {
                this._isRecording = false;
            }
        };
    }

    process(inputs, outputs, parameters) {
        if (this._isRecording) {
            const input = inputs[0];
            if (input && input.length > 0) {
                const left = input[0];
                const right = (input.length > 1) ? input[1] : left;
                
                if (left) {
                    this.port.postMessage({
                        command: 'DATA',
                        left: left,
                        right: right
                    });
                }
            }
        }
        return true;
    }
}
registerProcessor('recorder-processor', RecorderProcessor);
