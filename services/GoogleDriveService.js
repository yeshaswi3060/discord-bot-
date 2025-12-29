// Google Drive Service - Upload files to Google Drive
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

class GoogleDriveService {
    constructor() {
        this.drive = null;
        this.folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
        this.init();
    }

    init() {
        try {
            // Look for credentials file
            const credentialsPath = path.join(__dirname, '..', 'mtt-working-space-964c905202c0.json');

            if (!fs.existsSync(credentialsPath)) {
                console.warn('⚠️ Google Drive credentials not found. Recording upload disabled.');
                return;
            }

            const auth = new google.auth.GoogleAuth({
                keyFile: credentialsPath,
                scopes: ['https://www.googleapis.com/auth/drive.file']
            });

            this.drive = google.drive({ version: 'v3', auth });
            console.log('✅ Google Drive service initialized');
        } catch (error) {
            console.error('❌ Google Drive init error:', error.message);
        }
    }

    /**
     * Upload a file to Google Drive
     * @param {string} filePath - Local path to the file
     * @param {string} fileName - Name for the file in Drive
     * @returns {string|null} - File URL or null on error
     */
    async uploadFile(filePath, fileName) {
        if (!this.drive) {
            console.error('Google Drive not initialized');
            return null;
        }

        try {
            const fileMetadata = {
                name: fileName,
                parents: this.folderId ? [this.folderId] : undefined
            };

            const media = {
                mimeType: 'audio/mpeg',
                body: fs.createReadStream(filePath)
            };

            const response = await this.drive.files.create({
                resource: fileMetadata,
                media: media,
                fields: 'id, webViewLink, webContentLink'
            });

            // Make file publicly viewable
            await this.drive.permissions.create({
                fileId: response.data.id,
                requestBody: {
                    role: 'reader',
                    type: 'anyone'
                }
            });

            console.log(`✅ Uploaded to Drive: ${fileName}`);
            return {
                id: response.data.id,
                viewLink: response.data.webViewLink,
                downloadLink: response.data.webContentLink
            };
        } catch (error) {
            console.error('❌ Drive upload error:', error.message);
            return null;
        }
    }
}

module.exports = new GoogleDriveService();
