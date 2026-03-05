const FileUploadService = require('./services/FileUploadService');
const fs = require('fs');

async function testUpload() {
    fs.writeFileSync('test.txt', 'Hello World File.io Test');
    try {
        const result = await FileUploadService.uploadFile('test.txt', 'test.txt');
        console.log("Success:", result);
    } catch (e) {
        console.error("Test Error:", e);
    }
}
testUpload();
