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
     * Files expire after 14 days
     * @param {string} filePath - Local path to the file
     * @param {string} fileName - Name for the file
     * @returns {object|null} - { url, expires } or null on error
     */
    async uploadFile(filePath, fileName) {
        try {
            console.log(`📤 Uploading ${fileName} to file.io...`);

            const form = new FormData();
            form.append('file', fs.createReadStream(filePath), fileName);

            const response = await axios.post('https://file.io', form, {
                headers: {
                    ...form.getHeaders()
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });

            if (response.data.success) {
                console.log(`✅ Uploaded: ${response.data.link}`);
                return {
                    url: response.data.link,
                    expires: response.data.expires || '14 days'
                };
            } else {
                console.error('❌ file.io upload failed:', response.data);
                return null;
            }
        } catch (error) {
            console.error('❌ Upload error:', error.message);
            return null;
        }
    }
}

module.exports = new FileUploadService();
