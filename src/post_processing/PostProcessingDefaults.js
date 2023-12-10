// Loads the default set of post processing functions for a processedItem, depending on 
// the content type of the response.
module.exports = function (contentType) {
  const defaultFunctions = [
    {
      pattern: /^text\/html$/,
      functions: ['parsers/HTMLParser', 'storage/HTMLStore', 'transport/MQ']
    },
    {
      pattern: /image\/(.*)/,
      functions: ['parsers/GenericFileParser', 'storage/GenericFileStore']
    },
  ];

  return defaultFunctions.filter((item) => {
    return item.pattern.test(contentType);
  })[0].functions;
}