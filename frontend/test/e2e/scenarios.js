describe('metabase', function() {
    it('should redirect logged-out user to /auth/login', function() {
        browser.get('/metabase');
        expect(browser.getLocationAbsUrl()).toMatch("/metabase/auth/login");
    });
});
