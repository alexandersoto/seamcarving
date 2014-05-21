(function() {
    'use strict';

    // SeamCraver constructor
    function SeamCarverImage(pixels) {
        this.canvas = document.createElement('canvas');
        this.context = this.canvas.getContext('2d');
        this.setEndianness();

        // This is the data, and the images that will be resized
        this.pixels = this.cloneImageData(pixels);
        this.greyPixels = this.getGreyscale(pixels);
        this.gradientPixels = this.getGradientMagnitude(this.greyPixels);

        // Holds a visualization of the seam carving
        this.seamPixels = this.cloneImageData(pixels);
        this.seamGradientPixels = this.cloneImageData(this.gradientPixels);
    }

    // Determine endianness of machine
    SeamCarverImage.prototype.setEndianness = function() {
        var buf = new ArrayBuffer(64);
        var data = new Uint32Array(buf);
        data[1] = 0x0a0b0c0d;

        if (buf[4] === 0x0a && buf[5] === 0x0b && buf[6] === 0x0c && buf[7] === 0x0d) {
            this.isLittleEndian = false;
        }
        else {
            this.isLittleEndian = true;
        }
    };

    // Make a deep copy of pixels (ImageData)
    SeamCarverImage.prototype.cloneImageData = function (pixels) {
        var clonedPixels = this.getNewImageData(pixels.width, pixels.height);
        clonedPixels.data.set(pixels.data);
        return clonedPixels;
    };

    // Return an ImageData object with given width and height
    SeamCarverImage.prototype.getNewImageData = function (width, height) {
        return this.context.createImageData(width, height);
    };

    // Finds and remove the least important seam in the image
    SeamCarverImage.prototype.removeSeam = function () {
        var height = this.pixels.height;
        var width = this.pixels.width;
        var newWidth = width - 1;

        // Create a new image that is one column smaller
        var newPixels = this.getNewImageData(newWidth, height);
        var newGreyPixels = this.getNewImageData(newWidth, height);
        var newSeamPixels = this.cloneImageData(this.pixels);
        var newSeamGradientPixels = this.cloneImageData(this.gradientPixels);

        // Copy image data over 32 bits at a time with typed arrayws
        // https://hacks.mozilla.org/2011/12/faster-canvas-pixel-manipulation-with-typed-arrays/
        var pixels32 = new Uint32Array(this.pixels.data.buffer);
        var greyPixels32 = new Uint32Array(this.greyPixels.data.buffer);
        var newPixels32 = new Uint32Array(newPixels.data.buffer);
        var newGreyPixles32 = new Uint32Array(newGreyPixels.data.buffer);
        var newSeamPixels32 = new Uint32Array(newSeamPixels.data.buffer);
        var newSeamGradientPixels32 = new Uint32Array(newSeamGradientPixels.data.buffer);

        // Get the seam we want to remove
        var seam = this.findSeam();

        // Now fill in the smaller image by removing the seam
        for (var row = 0; row < height; row++) {
            var colToRemove = seam[row];

            var newPixelIndexBase = row * newWidth;
            var oldPixelIndexBase = row * width;

            for (var col = 0; col < width; col++) {
                var newPixelIndex = newPixelIndexBase + col;
                var oldPixelIndex = oldPixelIndexBase + col;

                // Copy pixels from the old image to the new one
                if (col < colToRemove) {
                    newPixels32[newPixelIndex] = pixels32[oldPixelIndex];
                    newGreyPixles32[newPixelIndex] = greyPixels32[oldPixelIndex];
                }

                // Copy pixels, shifting one pixel to the left 
                else if (col > colToRemove) {
                    newPixelIndex -= 1;
                    newPixels32[newPixelIndex] = pixels32[oldPixelIndex];
                    newGreyPixles32[newPixelIndex] = greyPixels32[oldPixelIndex];
                }

                // Don't copy pixels when col == colToRemove
                // Insert a red line where the seam we're removing is for visualization
                else {

                    /* jshint bitwise: false */
                    // Don't care about endianess because a red line at full alpha is the same in both cases
                    newSeamPixels32[oldPixelIndex] = (255 << 24) | 0 | 0 | 255;
                    newSeamGradientPixels32[oldPixelIndex] = (255 << 24) | 0 | 0 | 255;
                }
            }
        }

        // Store the updated results
        this.pixels = newPixels;
        this.greyPixels = newGreyPixels;
        this.seamPixels = newSeamPixels;
        this.seamGradientPixels = newSeamGradientPixels;

        // Recalculate the gradient magnitude as removing a seam changes adjacent pixels
        this.gradientPixels = this.getGradientMagnitude(this.greyPixels);
    };


    /*
     * Returns the min seam in the image - an array the same height as the image
     * where each entry specifies, for a single row, which column to remove.
     * So, if seam[5] = 3, then the minimum seam goes through the pixel at 
     * row 5 and column 3.
     */
    SeamCarverImage.prototype.findSeam = function () {

        // Find min seam by checking gradient
        var width = this.gradientPixels.width;
        var height = this.gradientPixels.height;
        var data = this.gradientPixels.data;

        // Will contains the seam information about the picture, where
        // the value at (i, j) is the minimum value of a seam ending at (i, j)
        // starting from row 0.
        //
        // For performance reasons, use a typed 1d array and index in row-major order
        // i.e. seamTable[i][j] = seamTable[i * width + j]
        //var seamTable = [];
        var seamTable = new Uint32Array(height * width);

        // Initialize the first row. The first row is just the value of the pixel
        for (var j = 0; j < width; j++) {

            // seamTable[0][j]
            seamTable[j] = this.getPixel(data, 0, j, width);
        }

        // Fill in the seam table with the dynamic programming algorithm
        // The seam at every point is the minimum of the 3 adjacent pixels
        // in the row above, plus itself
        for (var i = 1; i < height; i++) {
            for (j = 0; j < width; j++) {

                // seamTable[i-1][x]
                var rowOffset = (i-1) * width;

                // If we are at the left most edge, we can't check any pixels to the left
                if (j === 0) {
                    seamTable[i*width + j] = this.getPixel(data, i, j, width) +
                        Math.min(seamTable[rowOffset + j],
                                 seamTable[rowOffset + j + 1]);
                }

                // Similarly, if we are at the right most edge, we can't check any pixels to the right
                else if (j === (width - 1)) {
                    seamTable[i*width + j] = this.getPixel(data, i, j, width) +
                        Math.min(seamTable[rowOffset + j - 1],
                                 seamTable[rowOffset + j]);
                }

                // Check left, center, right
                else {
                    seamTable[i*width + j] = this.getPixel(data, i, j, width) +
                        Math.min(seamTable[rowOffset + j - 1],
                                seamTable[rowOffset + j],
                                seamTable[rowOffset + j + 1]);
                }
            }
        }

        // Find the minimum seam by checking the bottom col
        // Whichever has the smallest is the end point of the minimum seam
        var minCol = 0;
        for (j = 0; j < width; j++) {
            if (this.getPixel(data, height - 1, j, width) <
                this.getPixel(data, height - 1, minCol, width)) {
                    minCol = j;
            }
        }

        // Backtrack to get the seam vector
        return this.findMinSeam(seamTable, minCol, width, height);
    };

    // Backtrack through the table of minimum seams and find the path from minCol to row 0
    SeamCarverImage.prototype.findMinSeam = function (seamTable, minCol, width, height) {

        // The seam will need to be as long as # rows in the table
        var seam = new Uint32Array(height);

        // Go through all the rows and add the minimum adjacent pixel to the seam
        for (var i = height - 1; i > 0; i--) {
            seam[i] = minCol;

            // We want to check the next row
            // rowArray = seamTable[i - 1] (if it was a 2d array)
            var rowArray = seamTable.subarray((i-1)*width, i*width);
            minCol = this.getNextMinCol(rowArray, minCol);
        }
        seam[0] = minCol;

        return seam;
    };

    // Given a row of the seam table, calculate the index of the minimum col
    SeamCarverImage.prototype.getNextMinCol = function (rowArray, col) {

        // Check col-1, col, col+1 and return the minimum.
        // These statements check the edge cases of being
        // at the start and end of the table

        // All the way on the left
        if (col === 0) {
            if (rowArray[col] < rowArray[col + 1]) {
                return col;
            }
            else {
                return col + 1;
            }
        }

        // All the way on the right
        else if (col === rowArray.length - 1) {
            if (rowArray[col - 1] < rowArray[col]) {
                return col - 1;
            }
            else {
                return col;
            }
        }

        // Somewhere in the middle
        else {
            if ((rowArray[col - 1] < rowArray[col]) && (rowArray[col - 1] < rowArray[col + 1])) {
                return col - 1;
            }
            else if ((rowArray[col] < rowArray[col - 1]) && (rowArray[col] < rowArray[col + 1])) {
                return col;
            }
            else {
                return col + 1;
            }
        }
    };


    /* 
     * Calculate the gradient magnitude of a grey image
     * The magnitude of the gradient at a point is defined as:
     * 
     * g(i,j) = sqrt( ( p(i,j+1)-p(i,j) )^2 + ( p(i+1,j)-p(i,j) )^2 )
     *  
     * where p(i,j) is the value of the pixel at (i,j)
     * 
     * Any point outside of the frame is considered to have a pixel value 0
     */
    SeamCarverImage.prototype.getGradientMagnitude = function (greyPixels) {
        var gradientPixels = this.cloneImageData(greyPixels);
        var height = gradientPixels.height;
        var width = gradientPixels.width;

        var gradientData = gradientPixels.data;
        var greyData = greyPixels.data;

        // Write data 32 bits at a time
        // https://hacks.mozilla.org/2011/12/faster-canvas-pixel-manipulation-with-typed-arrays/
        var data32 = new Uint32Array(gradientData.buffer);

        for (var i = 0; i < height; i++) {
            for (var j = 0; j < width; j++) {
                var ij = this.getPixel(greyData, i, j, width);
                var iPlusOnej = (j+1) < width  ? this.getPixel(greyData, i, j+1, width) : 0;
                var ijPlusOne = (i+1) < height ? this.getPixel(greyData, i+1, j, width) : 0;

                var d1 = ijPlusOne - ij;
                var d2 = iPlusOnej - ij;
                var magnitude = Math.sqrt(d1*d1 + d2*d2);

                /* jshint bitwise: false */
                if (this.isLittleEndian) {
                    data32[i * width + j] = (255 << 24) | (magnitude << 16) | (magnitude << 8) | magnitude;
                }
                else {
                    data32[i * width + j] = (magnitude << 24) | (magnitude << 16) | (magnitude << 8) | 255;
                }
            }
        }
        return gradientPixels;
    };

    // Lets us access pixel as if it was a 2d array (only works for greyscale data)
    SeamCarverImage.prototype.getPixel = function (data, row, col, width) {
        return data[(row * width + col) * 4];
    };

    // Convert a set of colored pixels into a greyscale version
    // http://en.wikipedia.org/wiki/Grayscale
    SeamCarverImage.prototype.getGreyscale = function (pixels) {
        var greyPixels = this.cloneImageData(pixels);
        var colorData = pixels.data;
        var greyData = greyPixels.data;
        var dataLength = colorData.length;

        // 4 elements per pixel (rgba)
        for (var i = 0; i < dataLength; i += 4) {
            var r = colorData[i];
            var g = colorData[i + 1];
            var b = colorData[i + 2];
            // i+3 is alpha

            // Convert to greyscale using luminosity method
            greyData[i] = greyData[i + 1] = greyData[i + 2] = 0.2126*r + 0.7152*g + 0.0722*b;
            greyData[i + 3] = 255;
        }

        return greyPixels;
    };

    // Export to window
    window.SeamCarverImage = SeamCarverImage;

})();
