// File Upload Service - Upload recordings to file.io (free hosting)
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

class FileUploadService {
    constructor() {
        console.log('📁 File Upload Service initialized (using file.io)');
    }

    /**
     * Upload a file to file.io
     * @param {string} filePath - Local path to the file
     * @param {string} fileName - Name for the file
     * @returns {object|null} - { url } or null on error
     */
    async uploadFile(filePath, fileName) {
        try {
            // Check if file exists
            if (!fs.existsSync(filePath)) {
                console.error('❌ File not found:', filePath);
                return null;
            }

            const stats = fs.statSync(filePath);
            console.log(`📤 Uploading ${fileName} (${Math.round(stats.size / 1024)}KB) to file.io...`);

            const form = new FormData();
            form.append('file', fs.createReadStream(filePath), fileName);

            const response = await axios.post('https://file.io', form, {
                headers: form.getHeaders(),
                timeout: 120000, // 2 minute timeout
                maxContentLength: 100 * 1024 * 1024, // 100MB max
                maxBodyLength: 100 * 1024 * 1024
            });

            console.log('📥 file.io response:', JSON.stringify(response.data));

            if (response.data && response.data.success && response.data.link) {
                console.log(`✅ Uploaded successfully: ${response.data.link}`);
                return {
                    url: response.data.link
                };
            } else {
                console.error('❌ file.io upload failed - response:', response.data);
                return null;
            }
        } catch (error) {
            console.error('❌ Upload error:', error.message);
            if (error.response) {
                console.error('   Response status:', error.response.status);
                console.error('   Response data:', error.response.data);
            }
            return null;
        }
    }
}

module.exports = new FileUploadService();
