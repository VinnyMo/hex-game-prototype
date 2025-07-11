const { Worker } = require('worker_threads');
const path = require('path');
const { log, error } = require('./logging');

class WorkerPool {
    constructor(workerScript, poolSize = 3) {
        this.workerScript = workerScript;
        this.poolSize = poolSize;
        this.workers = [];
        this.availableWorkers = [];
        this.taskQueue = [];
        this.isInitialized = false;
    }

    async initialize() {
        if (this.isInitialized) return;

        for (let i = 0; i < this.poolSize; i++) {
            const worker = new Worker(path.resolve(__dirname, this.workerScript));
            
            worker.on('error', (err) => {
                error(`Worker ${i} error:`, err);
                this.replaceWorker(worker);
            });

            worker.on('exit', (code) => {
                if (code !== 0) {
                    error(`Worker ${i} exited with code ${code}`);
                    this.replaceWorker(worker);
                }
            });

            this.workers.push(worker);
            this.availableWorkers.push(worker);
        }

        this.isInitialized = true;
        log(`Worker pool initialized with ${this.poolSize} workers`);
    }

    async replaceWorker(deadWorker) {
        const index = this.workers.indexOf(deadWorker);
        if (index !== -1) {
            const newWorker = new Worker(path.resolve(__dirname, this.workerScript));
            
            newWorker.on('error', (err) => {
                error(`Replacement worker error:`, err);
                this.replaceWorker(newWorker);
            });

            newWorker.on('exit', (code) => {
                if (code !== 0) {
                    error(`Replacement worker exited with code ${code}`);
                    this.replaceWorker(newWorker);
                }
            });

            this.workers[index] = newWorker;
            
            // Remove dead worker from available list and add new one
            const availableIndex = this.availableWorkers.indexOf(deadWorker);
            if (availableIndex !== -1) {
                this.availableWorkers.splice(availableIndex, 1);
                this.availableWorkers.push(newWorker);
            }
        }
    }

    async executeTask(message) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        return new Promise((resolve, reject) => {
            const task = { message, resolve, reject };

            if (this.availableWorkers.length > 0) {
                this.assignTask(task);
            } else {
                this.taskQueue.push(task);
            }
        });
    }

    assignTask(task) {
        const worker = this.availableWorkers.pop();
        
        const timeout = setTimeout(() => {
            error('Worker task timeout');
            task.reject(new Error('Worker task timeout'));
            this.releaseWorker(worker);
        }, 30000); // 30 second timeout

        const onMessage = (response) => {
            clearTimeout(timeout);
            worker.off('message', onMessage);
            task.resolve(response);
            this.releaseWorker(worker);
        };

        worker.on('message', onMessage);
        worker.postMessage(task.message);
    }

    releaseWorker(worker) {
        if (this.workers.includes(worker)) {
            this.availableWorkers.push(worker);
            
            // Process next task in queue
            if (this.taskQueue.length > 0) {
                const nextTask = this.taskQueue.shift();
                this.assignTask(nextTask);
            }
        }
    }

    async shutdown() {
        log('Shutting down worker pool...');
        
        for (const worker of this.workers) {
            await worker.terminate();
        }
        
        this.workers = [];
        this.availableWorkers = [];
        this.taskQueue = [];
        this.isInitialized = false;
    }

    getStats() {
        return {
            totalWorkers: this.workers.length,
            availableWorkers: this.availableWorkers.length,
            queuedTasks: this.taskQueue.length
        };
    }
}

// Create singleton instances for different worker types
const exclamationWorkerPool = new WorkerPool('exclamationWorker.js', 1);

module.exports = {
    WorkerPool,
    exclamationWorkerPool
};