using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using System.Net.Http.Json;

namespace PdfEditor.Api.Tests;

public sealed class AuthenticationControllerTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> factory;

    public AuthenticationControllerTests(WebApplicationFactory<Program> factory) => this.factory = factory;

    [Fact]
    public async Task LoginEndpoint_ShouldExist()
    {
        var client = factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { emailAddress = "owner@pdfeditor.local", password = "Password123!" });
        response.StatusCode.Should().BeOneOf(System.Net.HttpStatusCode.OK, System.Net.HttpStatusCode.Unauthorized, System.Net.HttpStatusCode.InternalServerError);
    }
}
