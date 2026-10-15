/** Configures the root Angular module, components, forms, routing, and HTTP services. */
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';

import { AppRoutingModule } from './app-routing.module';

import { AppComponent } from './app.component';
import { PrefrencesComponent } from './preferences/prefrences.component';
import { LoginComponent } from './login/login.component';
import { HomeComponent } from './home/home.component';
import { SignupComponent } from './signup/signup.component';
import { InventoryComponent } from './inventory/inventory.component';
import { RecommendationsComponent } from './recommendations/recommendations.component';
import { HistoryComponent } from './history/history.component';
import { FloatingAiAssistantComponent } from './floating-ai-assistant/floating-ai-assistant.component';

@NgModule({
  declarations: [
    AppComponent,
    PrefrencesComponent,
    LoginComponent,
    HomeComponent,
    SignupComponent,
    InventoryComponent,
    RecommendationsComponent,
    HistoryComponent,
    FloatingAiAssistantComponent
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    FormsModule,
    HttpClientModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule {}
