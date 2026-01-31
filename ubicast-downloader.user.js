// ==UserScript==
// @name         Ubicast Video Extractor
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Extract video URLs from Ubicast platforms
// @match        *://*/*
// @grant        GM_setClipboard
// @grant        GM_notification
// ==/UserScript==

(function() {
    'use strict';
    
    // ============================================
    // Ubicast Video Extractor Class
    // ============================================
    
    class UbicastVideoExtractor {
        constructor(pageUrl = window.location.href) {
            this.pageUrl = pageUrl;
            this.domain = this.extractDomain(pageUrl);
            this.videoOID = null;
            this.videoData = {};
        }

        extractDomain(url) {
            const match = url.match(/^(https?:\/\/[^\/]+)/);
            return match ? match[1] : null;
        }

        async extractVideoOID() {
            // Method 1: From JavaScript player configuration
            if (typeof window.player !== 'undefined' && window.player && window.player.mediaOID) {
                this.videoOID = window.player.mediaOID;
                return this.videoOID;
            }

            // Method 2: From page source
            const bodyText = document.body.innerHTML;
            
            // Try mediaOID pattern
            let match = bodyText.match(/mediaOID:\s*["']([^"']+)["']/);
            if (match) {
                this.videoOID = match[1];
                return this.videoOID;
            }

            // Try permalink pattern in URL
            match = this.pageUrl.match(/\/permalink\/([^\/]+)/);
            if (match) {
                this.videoOID = match[1];
                return this.videoOID;
            }

            // Try videos pattern
            match = this.pageUrl.match(/\/videos\/[^\/]+/);
            if (match) {
                // Look for OID in meta tags or scripts
                const scripts = document.querySelectorAll('script');
                for (let script of scripts) {
                    const scriptMatch = script.textContent.match(/["']oid["']:\s*["']([^"']+)["']/);
                    if (scriptMatch) {
                        this.videoOID = scriptMatch[1];
                        return this.videoOID;
                    }
                }
            }

            // Try data attribute
            const playerElement = document.querySelector('[data-oid]');
            if (playerElement) {
                this.videoOID = playerElement.dataset.oid;
                return this.videoOID;
            }

            return null;
        }

        buildVideoURLs() {
            if (!this.videoOID || !this.domain) {
                return null;
            }

            return {
                oid: this.videoOID,
                domain: this.domain,
                hlsPlaylist: `${this.domain}/api/v2/medias/playlist/?oid=${this.videoOID}`,
                mediaInfo: `${this.domain}/api/v2/medias/get/?oid=${this.videoOID}`,
                resourcesInfo: `${this.domain}/api/v2/medias/resources-info/?oid=${this.videoOID}`,
                iframeEmbed: `${this.domain}/permalink/${this.videoOID}/iframe/`,
                permalink: `${this.domain}/permalink/${this.videoOID}/`,
            };
        }

        extractDownloadLinks() {
            const links = {
                video: [],
                audio: [],
                slides: null,
                hls: null
            };

            document.querySelectorAll('a.download, a[href*="downloads/file"]').forEach(link => {
                const href = link.getAttribute('href');
                const text = link.textContent;

                if (!href) return;

                const fullUrl = href.startsWith('http') ? href : this.domain + href;

                if (link.classList.contains('download-mp4') || href.includes('.mp4')) {
                    links.video.push({
                        url: fullUrl,
                        quality: text.match(/(\d+p)/)?.[1] || 'unknown',
                        size: text.match(/([\d.]+\s*[GM]B)/)?.[1] || 'unknown',
                        fullText: text.trim()
                    });
                } else if (link.classList.contains('download-mp3') || href.includes('.mp3')) {
                    links.audio.push({
                        url: fullUrl,
                        size: text.match(/([\d.]+\s*[GM]B)/)?.[1] || 'unknown'
                    });
                } else if (link.classList.contains('download-slides')) {
                    links.slides = fullUrl;
                } else if (link.classList.contains('download-hls') || href.includes('playlist')) {
                    links.hls = fullUrl;
                }
            });

            return links;
        }

        async fetchMediaInfo() {
            if (!this.videoOID) {
                await this.extractVideoOID();
            }

            if (!this.videoOID) {
                throw new Error('Could not extract video OID');
            }

            const apiUrl = `${this.domain}/api/v2/medias/get/?oid=${this.videoOID}`;
            
            try {
                const response = await fetch(apiUrl);
                const data = await response.json();
                return data;
            } catch (error) {
                console.error('Error fetching media info:', error);
                return null;
            }
        }

        async extractAll() {
            console.log('Starting extraction...');
            
            await this.extractVideoOID();
            
            if (!this.videoOID) {
                return {
                    success: false,
                    error: 'Could not find video OID'
                };
            }

            console.log('Found video OID:', this.videoOID);

            const urls = this.buildVideoURLs();
            const downloadLinks = this.extractDownloadLinks();
            
            let mediaInfo = null;
            try {
                mediaInfo = await this.fetchMediaInfo();
            } catch (e) {
                console.warn('Could not fetch media info:', e);
            }

            return {
                success: true,
                oid: this.videoOID,
                domain: this.domain,
                urls: urls,
                downloads: downloadLinks,
                mediaInfo: mediaInfo,
                title: mediaInfo?.title || document.title
            };
        }
    }
    
    // ============================================
    // Check if this is a Ubicast page
    // ============================================
    
    function isUbicastPage() {
        // Check for common Ubicast indicators
        return (
            document.body.innerHTML.includes('Powered by UBICAST') ||
            document.body.innerHTML.includes('UbiCast') ||
            document.querySelector('script[src*="ubicast"]') ||
            document.querySelector('.player-ui') ||
            typeof window.player !== 'undefined' ||
            document.body.innerHTML.includes('mediaOID')
        );
    }
    
    if (!isUbicastPage()) {
        console.log('Not a Ubicast page, skipping...');
        return;
    }
    
    console.log('Ubicast page detected! Adding extraction button...');
    
    // ============================================
    // Create UI
    // ============================================
    
    // Create button
    const button = document.createElement('button');
    button.textContent = '📥 Extract Video';
    button.id = 'ubicast-extract-btn';
    button.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        z-index: 99999;
        padding: 10px 15px;
        background: #4CAF50;
        color: white;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        font-weight: bold;
        box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        transition: background 0.3s;
    `;
    
    button.onmouseover = () => button.style.background = '#45a049';
    button.onmouseout = () => button.style.background = '#4CAF50';
    
    // Create results modal
    const modal = document.createElement('div');
    modal.id = 'ubicast-modal';
    modal.style.cssText = `
        display: none;
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 100000;
        background: white;
        color: black;
        padding: 20px;
        border-radius: 10px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        max-width: 80%;
        max-height: 80%;
        overflow: auto;
    `;
    
    const overlay = document.createElement('div');
    overlay.id = 'ubicast-overlay';
    overlay.style.cssText = `
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.7);
        z-index: 99999;
    `;
    
    overlay.onclick = () => {
        modal.style.display = 'none';
        overlay.style.display = 'none';
    };
    
    document.body.appendChild(overlay);
    document.body.appendChild(modal);
    document.body.appendChild(button);
    
    // ============================================
    // Button Click Handler
    // ============================================
    
    button.onclick = async () => {
        console.log('Extract button clicked!');
        
        button.textContent = '⏳ Extracting...';
        button.disabled = true;
        
        try {
            const extractor = new UbicastVideoExtractor();
            const data = await extractor.extractAll();
            
            console.log('Extraction complete:', data);
            
            if (data.success) {
                // Build HTML content
                let html = `
                    <h2 style="margin-top: 0;">🎥 Video Extraction Results</h2>
                    <button id="close-modal" style="position: absolute; top: 10px; right: 10px; background: #f44336; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer;">✕ Close</button>
                    
                    <div style="margin: 20px 0;">
                        <strong>Video OID:</strong> <code style="background: #f0f0f0; padding: 2px 5px; border-radius: 3px;">${data.oid}</code>
                        <button onclick="navigator.clipboard.writeText('${data.oid}')" style="margin-left: 10px; padding: 3px 8px; cursor: pointer;">📋 Copy</button>
                    </div>
                    
                    <div style="margin: 20px 0;">
                        <strong>Title:</strong> ${data.title}
                    </div>
                    
                    <h3>🔗 Streaming URL (HLS)</h3>
                    <div style="background: #f0f0f0; padding: 10px; border-radius: 5px; word-break: break-all; margin-bottom: 10px;">
                        <a href="${data.urls.hlsPlaylist}" target="_blank" style="color: #2196F3;">${data.urls.hlsPlaylist}</a>
                    </div>
                    <button onclick="navigator.clipboard.writeText('${data.urls.hlsPlaylist}')" style="padding: 5px 10px; cursor: pointer; background: #2196F3; color: white; border: none; border-radius: 3px;">📋 Copy HLS URL</button>
                `;
                
                if (data.downloads.video.length > 0) {
                    html += `<h3>📥 MP4 Downloads</h3><ul style="list-style: none; padding: 0;">`;
                    data.downloads.video.forEach(v => {
                        html += `
                            <li style="margin: 10px 0; background: #f9f9f9; padding: 10px; border-radius: 5px;">
                                <strong>${v.quality}</strong> (${v.size})<br>
                                <a href="${v.url}" target="_blank" style="color: #2196F3; word-break: break-all;">${v.url}</a>
                                <button onclick="navigator.clipboard.writeText('${v.url}')" style="margin-left: 10px; padding: 3px 8px; cursor: pointer;">📋 Copy</button>
                            </li>
                        `;
                    });
                    html += `</ul>`;
                }
                
                if (data.downloads.audio.length > 0) {
                    html += `<h3>🎵 Audio Download</h3><ul style="list-style: none; padding: 0;">`;
                    data.downloads.audio.forEach(a => {
                        html += `
                            <li style="margin: 10px 0; background: #f9f9f9; padding: 10px; border-radius: 5px;">
                                ${a.size}<br>
                                <a href="${a.url}" target="_blank" style="color: #2196F3; word-break: break-all;">${a.url}</a>
                                <button onclick="navigator.clipboard.writeText('${a.url}')" style="margin-left: 10px; padding: 3px 8px; cursor: pointer;">📋 Copy</button>
                            </li>
                        `;
                    });
                    html += `</ul>`;
                }
                
                html += `
                    <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd;">
                        <small style="color: #666;">💡 Tip: Use VLC or any HLS-compatible player to play the HLS URL</small>
                    </div>
                `;
                
                modal.innerHTML = html;
                modal.style.display = 'block';
                overlay.style.display = 'block';
                
                // Add close button handler
                document.getElementById('close-modal').onclick = () => {
                    modal.style.display = 'none';
                    overlay.style.display = 'none';
                };
                
                // Also log to console
                console.log('📥 Video URLs:', data);
                
            } else {
                modal.innerHTML = `
                    <h2 style="color: #f44336;">❌ Extraction Failed</h2>
                    <p>${data.error}</p>
                    <p>This might not be a video page, or the video might be using a different structure.</p>
                    <button onclick="this.parentElement.style.display='none'; document.getElementById('ubicast-overlay').style.display='none';" style="margin-top: 10px; padding: 8px 15px; cursor: pointer;">Close</button>
                `;
                modal.style.display = 'block';
                overlay.style.display = 'block';
            }
            
        } catch (error) {
            console.error('Extraction error:', error);
            modal.innerHTML = `
                <h2 style="color: #f44336;">❌ Error</h2>
                <p>${error.message}</p>
                <pre style="background: #f0f0f0; padding: 10px; border-radius: 5px; overflow: auto;">${error.stack}</pre>
                <button onclick="this.parentElement.style.display='none'; document.getElementById('ubicast-overlay').style.display='none';" style="margin-top: 10px; padding: 8px 15px; cursor: pointer;">Close</button>
            `;
            modal.style.display = 'block';
            overlay.style.display = 'block';
        } finally {
            button.textContent = '📥 Extract Video';
            button.disabled = false;
        }
    };
    
    console.log('✅ Ubicast Video Extractor loaded successfully!');
    
})();
