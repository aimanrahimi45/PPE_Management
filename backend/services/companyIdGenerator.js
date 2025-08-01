const crypto = require('crypto');

/**
 * Company ID Generator - Creates unique, short, memorable company IDs
 * Format: CompanyName + 4 digits (e.g., ABCMFG2024, TESLA3456)
 */
class CompanyIdGenerator {
  constructor() {
    this.usedIds = new Set(); // In-memory cache for current session
  }

  /**
   * Generate a unique company ID based on company name
   * @param {string} companyName - Company name
   * @param {Function} checkExistsFn - Async function to check if ID exists in database
   * @returns {Promise<string>} Unique company ID
   */
  async generateUniqueId(companyName, checkExistsFn) {
    if (!companyName || typeof companyName !== 'string') {
      throw new Error('Company name is required and must be a string');
    }

    const baseId = this.createBaseId(companyName);
    let attempts = 0;
    const maxAttempts = 100;

    while (attempts < maxAttempts) {
      const companyId = this.addUniqueNumber(baseId);
      
      // Check if ID is already used (memory cache + database)
      if (!this.usedIds.has(companyId)) {
        const existsInDb = await checkExistsFn(companyId);
        
        if (!existsInDb) {
          this.usedIds.add(companyId);
          console.log(`✅ Generated unique company ID: ${companyId} (attempts: ${attempts + 1})`);
          return companyId;
        }
      }
      
      attempts++;
    }

    // Fallback to crypto-based ID if can't generate from company name
    const fallbackId = this.generateFallbackId();
    console.log(`⚠️ Used fallback ID generation: ${fallbackId} (after ${maxAttempts} attempts)`);
    return fallbackId;
  }

  /**
   * Create base ID from company name
   * @param {string} companyName - Company name
   * @returns {string} Base ID (6-8 characters)
   */
  createBaseId(companyName) {
    // Clean and normalize company name
    const cleaned = companyName
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '') // Remove special characters
      .replace(/\s+/g, ''); // Remove spaces

    // Strategy 1: Use first letters of each word
    const words = companyName.toUpperCase().split(/\s+/);
    if (words.length >= 2) {
      let acronym = words.map(word => word.charAt(0)).join('');
      if (acronym.length >= 3 && acronym.length <= 6) {
        return acronym;
      }
    }

    // Strategy 2: Use first 6 characters of cleaned name
    if (cleaned.length >= 3) {
      return cleaned.substring(0, Math.min(6, cleaned.length));
    }

    // Strategy 3: Fallback to first 3 + company hash
    const hash = crypto.createHash('md5').update(companyName).digest('hex');
    return (cleaned.substring(0, 3) + hash.substring(0, 3)).toUpperCase();
  }

  /**
   * Add unique 4-digit number to base ID
   * @param {string} baseId - Base company ID
   * @returns {string} Complete company ID
   */
  addUniqueNumber(baseId) {
    // Generate 4-digit number (1000-9999)
    const randomNum = Math.floor(Math.random() * 9000) + 1000;
    return `${baseId}${randomNum}`;
  }

  /**
   * Generate fallback ID using crypto
   * @returns {string} Fallback company ID
   */
  generateFallbackId() {
    const timestamp = Date.now().toString().slice(-4); // Last 4 digits of timestamp
    const random = crypto.randomBytes(2).toString('hex').toUpperCase(); // 4 random hex chars
    return `PPE${timestamp}${random}`;
  }

  /**
   * Validate company ID format
   * @param {string} companyId - Company ID to validate
   * @returns {boolean} True if valid format
   */
  isValidCompanyId(companyId) {
    if (!companyId || typeof companyId !== 'string') {
      return false;
    }

    // Should be 7-10 characters, alphanumeric only, ending with 4 digits
    // Letters part should be 3-6 characters, numbers part should be exactly 4 digits
    const pattern = /^[A-Z0-9]{3,6}\d{4}$/;
    return pattern.test(companyId) && companyId.length >= 7 && companyId.length <= 10;
  }

  /**
   * Extract company name hint from ID (for display purposes)
   * @param {string} companyId - Company ID
   * @returns {string} Company name hint
   */
  extractNameHint(companyId) {
    if (!this.isValidCompanyId(companyId)) {
      return companyId;
    }

    // Remove the last 4 digits to get the base name
    return companyId.slice(0, -4);
  }

  /**
   * Generate multiple ID suggestions for manual selection
   * @param {string} companyName - Company name
   * @param {number} count - Number of suggestions (default: 5)
   * @returns {Array<string>} Array of suggested IDs
   */
  generateSuggestions(companyName, count = 5) {
    const suggestions = [];
    const baseId = this.createBaseId(companyName);

    for (let i = 0; i < count; i++) {
      suggestions.push(this.addUniqueNumber(baseId));
    }

    return suggestions;
  }

  /**
   * Clear memory cache (useful for testing)
   */
  clearCache() {
    this.usedIds.clear();
    console.log('🗑️ Company ID cache cleared');
  }
}

/**
 * Test examples for different company names
 */
function testIdGeneration() {
  const generator = new CompanyIdGenerator();
  
  const testCases = [
    'ABC Manufacturing',      // Expected: ABC1234, ABCM1234
    'Tesla Motors',          // Expected: TM1234, TESLA1234  
    'Google Inc',            // Expected: GI1234, GOOGLE1234
    'Microsoft Corporation', // Expected: MC1234, MICROS1234
    'Apple',                 // Expected: APPLE1234
    'IBM',                   // Expected: IBM1234
    'A',                     // Edge case: single character
    '123 Numbers Company',   // Edge case: starts with numbers
    'Special-Chars & Co!',   // Edge case: special characters
  ];

  console.log('🧪 Testing Company ID Generation:');
  console.log('=====================================');

  testCases.forEach((companyName, index) => {
    const baseId = generator.createBaseId(companyName);
    const suggestions = generator.generateSuggestions(companyName, 3);
    
    console.log(`${index + 1}. "${companyName}"`);
    console.log(`   Base ID: ${baseId}`);
    console.log(`   Suggestions: ${suggestions.join(', ')}`);
    console.log(`   Valid format: ${suggestions.every(id => generator.isValidCompanyId(id))}`);
    console.log('');
  });
}

module.exports = {
  CompanyIdGenerator,
  testIdGeneration
};